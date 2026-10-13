import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use a public HTTP or HTTPS job URL.');
  url.hash = '';
  for (const name of [...url.searchParams.keys()])
    if (/^(utm_|ref$|refId$|trackingId$|source$|trk$)/i.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString();
}
function privateAddress(ip: string): boolean {
  if (ip.includes(':')) return /^(::|fc|fd|fe[89ab])/i.test(ip) || ip.includes('ffff:');
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
export async function assertPublicUrl(value: string) {
  const url = new URL(canonicalUrl(value));
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Unsupported URL port.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address)))
    throw new Error('Job imports require a public internet address.');
  return url;
}
export function parsePage(html: string): {
  title: string;
  company: string;
  description: string;
  method: string;
} {
  const $ = cheerio.load(html);
  let posting: any;
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if ([value['@type']].flat().includes('JobPosting')) posting ??= value;
    if (value['@graph']) visit(value['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      visit(JSON.parse($(script).text()));
    } catch {}
  });
  $('script,style,nav,footer,header,noscript,svg').remove();
  const fromHtml = (value: string) =>
    cheerio
      .load(value.replace(/<\/(p|div|li|h[1-6])>/gi, '</$1>\n'))
      .text()
      .replace(/[\t ]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  const content =
    posting?.description ||
    $(
      '[data-testid="job-description"],.job__description,#content .content,.job-description,main,article',
    )
      .first()
      .html() ||
    $('body').html() ||
    '';
  const description = fromHtml(content).slice(0, 100_000);
  return {
    title: String(posting?.title || $('h1').first().text() || $('title').text()).trim(),
    company: String(posting?.hiringOrganization?.name || ''),
    description,
    method: posting ? 'jobposting-jsonld-v1' : 'readable-html-v1',
  };
}
export async function fetchDescription(value: string, signal?: AbortSignal) {
  let url = await assertPublicUrl(value);
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: signal ?? AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'CareerStudio/1.0 (personal job research)',
        Accept: 'text/html,application/json',
      },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = await assertPublicUrl(new URL(response.headers.get('location') ?? '', url).toString());
      continue;
    }
    if (!response.ok)
      throw new Error(`Source returned HTTP ${response.status}. Try the browser importer.`);
    if (!response.body) throw new Error('Source returned no content.');
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > 4_000_000) {
        await reader.cancel();
        throw new Error('Page exceeds the import size limit.');
      }
      chunks.push(chunk);
    }
    const page = parsePage(Buffer.concat(chunks).toString('utf8'));
    if (page.description.length < 200 || /^(just a moment|access denied|sign in)/i.test(page.title))
      throw new Error('This page needs the signed-in browser importer.');
    return page;
  }
  throw new Error('Too many redirects.');
}
export const contentHash = (text: string) =>
  createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
