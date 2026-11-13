// A resume as a PDF that both a person and an applicant tracking system read cleanly: one column,
// real text in a common font, standard section names, no tables, images, columns or text boxes.
// Chrome prints it from plain HTML, then the PDF's text is read back, the way a parser would, to
// check that nothing was lost and that the sections and the posting's terms are really in the file.
import { bullets, density, overall, type Part, REQUIRED, unreadable, WEIGHTS } from './ats.ts';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { inData } from './paths.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A hyphenated word ("forward-deployed") is kept on one line: broken at its hyphen, a parser reads it back as
// "forward- deployed" and a search for the term misses it. The hyphen itself is left as typed.
const whole = (s: string) => s.replace(/(?<![\w&;/.@-])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?![\w/@-])/g, '<span class="nb">$&</span>');
const inline = (s: string) => whole(esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;]|$)/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)'));
// The contact line: each detail stays whole on its line, an email or a web address is a real link a recruiter
// can click, and the details are parted by " | ", plain ASCII that every parser keeps.
const contact = (line: string) => line.split(/\s+[·|•]\s+/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const t = esc(x), href = /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(x) ? `mailto:${x}` : /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/.test(x) ? (x.startsWith('http') ? x : `https://${x}`) : '';
  return `<span class="nb">${href ? `<a href="${esc(href)}">${t}</a>` : t}</span>`;
}).join(' | ');
// The line under a role: its dates and place in plain ASCII ("Oct 2024 - Present | Remote").
const plain = (line: string) => line.replace(/\s+[–—]\s+/g, ' - ').replace(/\s+[·•]\s+/g, ' | ');

// The resume's Markdown as the few HTML elements a resume needs. The line under the name is the
// contact line, and the line under a role's heading is its dates and place.
// `companies` are the employers' names as the bank has them. A role's heading "Title, Company" is printed as the
// title on its own line and the company at the start of the next, with the dates: a title that holds a comma
// ("Director, Software Engineering, Acme") leaves a parser guessing which part is the employer.
export function resumeHtml(markdown: string, scale = 1, companies: string[] = []): string {
  const out: string[] = [], known = [...companies].filter(Boolean).sort((a, b) => b.length - a.length);
  let list = false, after = '', company = '';
  const owed = () => { if (company) { out.push(`<p class="when">${inline(company)}</p>`); company = ''; } };
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of markdown.split('\n')) {
    const l = raw.trimEnd();
    if (l.trim() === '') { close(); continue; }
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      close(); owed();
      let title = h[2].trim();
      if (h[1].length === 3) { const at = known.find((c) => title.toLowerCase().endsWith(`, ${c.toLowerCase()}`)); if (at) { company = title.slice(title.length - at.length); title = title.slice(0, title.length - at.length - 2); } }
      out.push(`<h${h[1].length}>${inline(title)}</h${h[1].length}>`); after = `h${h[1].length}`; continue;
    }
    const b = l.match(/^\s*[-*]\s+(.*)$/);
    if (b) { owed(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(b[1])}</li>`); after = ''; continue; }
    close();
    if (after === 'h1') out.push(`<p class="contact">${contact(l)}</p>`);
    else if (after === 'h3') { out.push(`<p class="when">${company ? `${inline(company)} | ` : ''}${inline(plain(l))}</p>`); company = ''; }
    else { owed(); out.push(`<p>${inline(l)}</p>`); }
    after = '';
  }
  close(); owed();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc((markdown.match(/^#\s+(.*)$/m)?.[1] ?? 'Resume').trim())}</title><style>
@page { size: Letter; margin: ${scale < 1 ? '0.45in 0.6in' : '0.55in 0.7in'}; }
* { box-sizing: border-box; }
body { margin: 0; font: ${(10 * scale).toFixed(2)}pt/${scale < 1 ? 1.3 : 1.36} Arial, Helvetica, sans-serif; color: #000; font-variant-ligatures: none; font-kerning: normal; }
h1 { font-size: ${(20 * scale).toFixed(1)}pt; line-height: 1.15; margin: 0 0 3pt; }
.contact { margin: 0 0 8pt; color: #222; font-size: 0.92em; }
h2 { font-size: ${(11.5 * scale).toFixed(2)}pt; margin: 12pt 0 5pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #000; break-after: avoid; }
h3 { font-size: ${(10 * scale).toFixed(2)}pt; margin: 8pt 0 0; break-after: avoid; }
.when { margin: 0 0 3pt; color: #333; break-after: avoid; }
p { margin: 0 0 4pt; }
ul { margin: 2pt 0 4pt; padding-left: 14pt; }
li { margin: 0 0 2.5pt; break-inside: avoid; }
.nb { white-space: nowrap; }
a { color: inherit; text-decoration: none; }
</style></head><body>${out.join('\n')}</body></html>`;
}

const chrome = () => [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', Bun.which('google-chrome'), Bun.which('chromium'), Bun.which('chromium-browser')]
  .find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p));

// Prints the resume to fit `pages`. When the text runs a little over, the type is stepped down, never
// below 9 point, which is as small as a resume stays comfortable to read; past that it is left over
// length and the check says so.
export async function renderPdf(markdown: string, pages = 2, companies: string[] = []): Promise<Uint8Array> {
  let out = await print(markdown, 1, companies);
  for (const scale of [0.96, 0.93, 0.9]) {
    if ((await getDocumentProxy(out.slice())).numPages <= pages) break;
    out = await print(markdown, scale, companies);
  }
  return out;
}

async function print(markdown: string, scale: number, companies: string[]): Promise<Uint8Array> {
  const bin = chrome();
  if (!bin) throw new Error('No Chrome or Chromium on the server to print the PDF. Install one, or set CHROME to its path.');
  const dir = join(tmpdir(), `egg-pdf-${process.pid}-${Date.now()}-${Math.round(scale * 100)}`);
  mkdirSync(dir, { recursive: true });
  try {
    await Bun.write(join(dir, 'resume.html'), resumeHtml(markdown, scale, companies));
    const proc = Bun.spawn([bin, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(dir, 'profile')}`, '--no-pdf-header-footer', `--print-to-pdf=${join(dir, 'resume.pdf')}`, `file://${join(dir, 'resume.html')}`], { stdout: 'ignore', stderr: 'ignore' });
    const timer = setTimeout(() => proc.kill(), 45_000);
    await proc.exited; clearTimeout(timer);
    if (!existsSync(join(dir, 'resume.pdf'))) throw new Error('Chrome did not produce the PDF.');
    return new Uint8Array(await Bun.file(join(dir, 'resume.pdf')).arrayBuffer());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// What a parser gets from the file. Each line is a plain statement the person can act on.
// score is the four parts weighed (lib/ats.ts); a check made before the parts were scored has neither.
export type AtsCheck = { ok: boolean; pages: number; lines: { label: string; ok: boolean; note: string }[]; score?: number; parts?: Part[]; required?: number };
const SECTIONS = ['Summary', 'Experience', 'Skills', 'Education'];
export async function atsCheck(pdf: Uint8Array, markdown: string, terms: { inResume: string[]; inBankOnly: string[]; missing: string[] }, pages = 2, tools: string[] = []): Promise<AtsCheck> {
  const doc = await getDocumentProxy(pdf.slice());
  const { totalPages, text } = await extractText(doc, { mergePages: true });
  const read = (Array.isArray(text) ? text.join(' ') : text).replace(/\s+/g, ' ');
  const words = (s: string) => s.replace(/[#*_`>|-]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const want = words(markdown), got = new Set(words(read));
  const kept = want.length === 0 ? 1 : want.filter((w) => got.has(w)).length / want.length;
  const has = (t: string) => read.toLowerCase().includes(t.toLowerCase());
  const order = SECTIONS.map((s) => read.indexOf(s)).filter((i) => i >= 0);
  const found = SECTIONS.filter((s) => read.includes(s));
  const total = terms.inResume.length + terms.inBankOnly.length + terms.missing.length, lost = terms.inResume.filter((t) => !has(t));
  const odd = unreadable(read), count = read.split(' ').filter(Boolean).length, room = density(count, pages);
  // A bullet names its method when it names one of the posting's terms or a tool the bank holds.
  const b = bullets(markdown, [...terms.inResume, ...terms.inBankOnly, ...tools]);
  // The top third of the file is what a recruiter's first glance takes in: the posting's terms should be there.
  const top = read.slice(0, Math.ceil(read.length * 0.3)).toLowerCase(), up = terms.inResume.filter((t) => top.includes(t.toLowerCase()));
  const lines = [
    { label: 'Text reads back', ok: kept > 0.97, note: kept > 0.97 ? 'Every word in the resume is in the file as real text, in reading order.' : `Only ${Math.round(kept * 100)}% of the words read back from the file. Something in it is not plain text.` },
    { label: 'Length', ok: totalPages <= pages, note: `${totalPages} ${totalPages === 1 ? 'page' : 'pages'}.${totalPages > pages ? ` It was meant to fit ${pages === 1 ? 'one page' : 'two pages'}: cut a few bullets in Edit Resume.` : ''}` },
    { label: 'Standard sections', ok: found.includes('Experience') && found.includes('Skills') && order.every((v, i) => i === 0 || v > order[i - 1]), note: found.length ? `Found, in order: ${found.join(', ')}.` : 'No standard section names were found.' },
    { label: 'Contact details', ok: /[\w.+-]+@[\w-]+\.[\w.]+/.test(read.slice(0, 400)), note: /[\w.+-]+@[\w-]+\.[\w.]+/.test(read.slice(0, 400)) ? 'An email address is at the top.' : 'No email address near the top. Add one to the first line under your name.' },
    { label: 'Posting’s terms', ok: lost.length === 0 && terms.inBankOnly.length === 0, note: total === 0 ? 'The posting’s terms were not listed.' : `${terms.inResume.length - lost.length} of ${total} are in the file.${terms.inBankOnly.length ? ` Your bank supports ${terms.inBankOnly.join(', ')}, which the resume leaves out.` : ''}${terms.missing.length ? ` Not in your bank, so not added: ${terms.missing.join(', ')}.` : ''}` },
    { label: 'Characters', ok: odd === 0, note: odd === 0 ? 'Every character is one a parser can index.' : `${odd} ${odd === 1 ? 'character has' : 'characters have'} no readable meaning in the file, so the words around ${odd === 1 ? 'it' : 'them'} can’t be searched.` },
    { label: 'Word count', ok: room.score === 100, note: `${count} words. ${pages === 1 ? 'One page' : 'Two pages'} read well between ${room.low} and ${room.high.toLocaleString('en-US')}.` },
    { label: 'Top of page one', ok: up.length >= Math.min(3, terms.inResume.length), note: terms.inResume.length === 0 ? 'The posting’s terms were not listed.' : `${up.length} of the posting’s ${terms.inResume.length} terms in the resume are in its top third${up.length ? `: ${up.slice(0, 6).join(', ')}` : ''}.` },
    { label: 'Bullets', ok: b.flags.length === 0, note: b.count === 0 ? 'No bullets were found under Experience or Projects.' : `${b.measured} of ${b.count} state a measured result.${b.flags.length ? ` ${b.flags.length} to fix: ${b.flags.slice(0, 3).map((f) => `“${f.quote.split(' ').slice(0, 6).join(' ')}…” ${f.why}`).join(' ')}` : ' None opens as a duty, runs long or repeats its opening verb.'}` },
  ];
  const structure = ['Text reads back', 'Length', 'Standard sections', 'Contact details', 'Characters'].map((l) => lines.find((x) => x.label === l)!.ok);
  const parts: Part[] = [
    // Of the posting's terms the bank supports, the share that reads back from the file.
    { label: 'Supported terms', weight: WEIGHTS.terms, score: terms.inResume.length + terms.inBankOnly.length === 0 ? 100 : Math.round(((terms.inResume.length - lost.length) / (terms.inResume.length + terms.inBankOnly.length)) * 100) },
    { label: 'Bullets', weight: WEIGHTS.bullets, score: b.score },
    { label: 'Structure', weight: WEIGHTS.structure, score: Math.round((structure.filter(Boolean).length / structure.length) * 100) },
    { label: 'Word count', weight: WEIGHTS.density, score: room.score },
  ];
  return { ok: lines.every((l) => l.ok), pages: totalPages, lines, score: overall(parts), parts, required: REQUIRED };
}

// Where a job's PDF is kept, named for the person and the job; an earlier file for the same job is replaced.
export function pdfPath(job: { id: number; company: string; title: string }, markdown: string): string {
  const dir = inData('resumes');
  mkdirSync(dir, { recursive: true });
  const part = (s: string) => s.replace(/[^\w .&-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  const name = part(markdown.match(/^#\s+(.*)$/m)?.[1] ?? 'Resume');
  for (const old of readdirSync(dir).filter((f) => f.startsWith(`${job.id}-`) && f.endsWith('.pdf'))) rmSync(join(dir, old));
  return join(dir, `${job.id}-${[name, part(job.company), part(job.title)].filter(Boolean).join(' - ')}.pdf`);
}
