import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';
import { canonicalUrl, parsePage } from '@repo/domain/research';
import { readTrueUpTracker } from './lib/trueup';

const studio = process.env.STUDIO_URL ?? 'http://127.0.0.1:3001';
const isLocal = (url: string) =>
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
if (!isLocal(studio)) throw new Error('Start local Studio for browser imports.');
const cdp = process.env.TRUEUP_CDP_URL;
if (cdp && !isLocal(cdp)) throw new Error('The browser connection must be local.');
const api = async (action: string, input: unknown = {}) => {
  const response = await fetch(`${studio}/api/studio/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Studio request failed');
  return data;
};
await api('workspace');
const connected = cdp ? await chromium.connectOverCDP(cdp) : undefined;
const browser =
  connected?.contexts()[0] ??
  (await chromium.launchPersistentContext(resolve('.data/browser'), {
    headless: false,
    channel: process.env.BROWSER_CHANNEL || undefined,
  }));
try {
  const page =
    browser.pages().find((p) => p.url().includes('trueup.io')) ?? (await browser.newPage());
  if (!cdp) {
    await page.goto('https://www.trueup.io/jobtracker');
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    console.log(
      'Sign in to TrueUp in the browser. This imports saved jobs, application states, and descriptions into Studio.',
    );
    await ask.question('Press Enter when the tracker is ready. ');
    ask.close();
  }
  const noOffer = process.argv.includes('--no-offer=rejected') ? 'rejected' : 'closed';
  const records = await readTrueUpTracker(page, noOffer);
  console.log(`Read ${records.length} jobs across all three tracker tabs.`);
  const queued = await api('research.queue', { urls: records.map((r) => r.url) });
  if (queued.some((row: any) => row.status === 'invalid'))
    throw new Error('At least one source URL is invalid.');
  const workspace = await api('workspace');
  const listings = new Map(workspace.listings.map((l: any) => [l.url, l]));
  const capture = await browser.newPage();
  let tracked = 0,
    captured = 0,
    blocked = 0;
  for (const record of records) {
    const listing: any = listings.get(canonicalUrl(record.url));
    if (!listing) throw new Error('Queued listing was not found.');
    const result = await api('jobs.track', {
      listingId: listing.id,
      title: record.title,
      company: record.company,
      stage: record.stage,
      source: 'TrueUp',
      sourceDetails: `Observed ${new Date().toISOString()}. Source snapshot (Saved age is not an application or rejection date):\n\n${record.sourceDetails}`,
    });
    if (result.created) tracked++;
    if (listing.status === 'ready') {
      console.log(`Already parsed: ${record.company} · ${record.title}`);
      continue;
    }
    try {
      await capture.goto(record.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await capture.waitForTimeout(1500);
      const parsed = parsePage(await capture.content());
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const content = parsed.description;
      const visibleTitle = await capture
        .locator('h1')
        .first()
        .innerText({ timeout: 3000 })
        .catch(() => parsed.title);
      if (
        content.length < 200 ||
        /^(just a moment|access denied|sign in)/i.test(parsed.title) ||
        /job (?:is )?(?:no longer|not found)|position (?:has been filled|is no longer available)|job posting (?:has expired|is no longer)/i.test(
          content,
        )
      )
        throw new Error('Original description is unavailable or requires browser attention.');
      if (
        !normalize(`${parsed.title} ${content} ${visibleTitle}`).includes(normalize(record.title))
      )
        throw new Error(
          'Page does not contain the saved job title; may be a careers index or expired posting.',
        );
      await api('research.capture', {
        id: listing.id,
        title: record.title,
        company: record.company,
        description: content,
        method: parsed.method === 'jobposting-jsonld-v1' ? parsed.method : 'trueup-browser-v1',
      });
      captured++;
      console.log(`Captured ${record.company} · ${record.title}`);
    } catch (error) {
      blocked++;
      await api('research.blocked', {
        id: listing.id,
        error: error instanceof Error ? error.message : 'Browser capture failed.',
      });
      console.log(`Needs source: ${record.company} · ${record.title}`);
    }
  }
  await capture.close();
  console.log(
    JSON.stringify({ total: records.length, newTracked: tracked, captured, needsSource: blocked }),
  );
  console.log('In local Studio → Job research, choose Process with Eve to extract requirements.');
} finally {
  if (connected) await connected.close();
  else await browser.close();
}
