// A resume's Markdown read into a structure, once, for every check that needs to know what is where:
// the name, the contact line, the summary, each experience entry (title, company, date ranges, labels,
// place, context lines, bullets, its Technologies line), the one-line "Earlier experience" section, skills and education.
// It never throws: a hand-edited resume is read as far as it can be, and whatever could not be placed is
// kept in `unplaced`. This file opens no database and asks no model.
//
// An entry is read wherever it is written, so a job cannot hide from the facts check (lib/entries.ts): a
// "###" heading in any section but Education and Skills, or a line all in bold with a dated line under it. Entries
// outside Experience and Projects are kept in `elsewhere`. A line that holds a date range and is not part
// of an entry's own heading lines is kept in `dated`. Line endings of any kind are read as plain ones.
//
// The layout it reads (and the writer is told to write, lib/jobs.ts):
//   # Name
//   contact line
//   ## Summary
//   ## Experience
//   ### Title, Company
//   Mar 2021 – Present · Contract · Remote        dates; then labels and the place, parted by a middle dot
//   Previously Senior Engineer, Jan 2019 – Feb 2021   an earlier title at the same employer
//   A context line.                                   a plain line that is neither of the above
//   - bullets
//   Technologies: Go, Kafka                           the technologies of the entry, written by code (lib/skills.ts)
//   ## Earlier experience
//   Title, Company (2012 – 2014); Title, Company (2010 – 2012)
//   ## Skills
//   ## Education

export type Range = { start: string; end: string; text: string }; // "YYYY-MM" or "YYYY"; an end of "" is the present
// technologies: the items of the entry's "Technologies:" line (RESUME-RULES.md, rule 14). That line is no bullet, no
// context line and no note, wherever in the entry it stands, and with or without a bullet's mark.
export type Entry = { section: string; heading: string; title: string; company: string; ranges: Range[]; labels: string[]; place: string;
  previously: { title: string; ranges: Range[] }[]; notes: string[]; bullets: string[]; technologies: string[]; current: boolean;
  // Line numbers in the Markdown, for a repair that rewrites only the lines it must (lib/entries.ts, lib/skills.ts).
  at: { heading: number; dates: number; previously: number[]; technologies: number[]; lines: number[] } };
export type Earlier = { text: string; title: string; company: string; ranges: Range[] };
export type Outline = { kind: 'name' | 'header' | 'summary' | 'heading' | 'bullet'; text: string; line: number };
export type Resume = { name: string; contact: string; summary: string; sections: string[]; experience: Entry[]; projects: Entry[]; elsewhere: Entry[];
  earlier: Earlier[]; earlierAt: number[]; skills: string[]; education: string[]; other: { section: string; lines: string[] }[];
  dated: { line: number; text: string }[]; unplaced: string[]; outline: Outline[] };

// Windows and old Mac line endings as plain ones, so no line keeps a stray "\r".
export const lf = (text: string) => text.replace(/\r\n?/g, '\n');

export const STANDARD = ['Summary', 'Experience', 'Earlier experience', 'Skills', 'Education'];
// What may follow the dates on the line under a role's heading, besides the place.
// An entry's Technologies line, as code writes it ("Technologies: Go, Kafka") and as a hand edit may leave it.
export const TECHNOLOGIES = /^technologies:\s*(.*)$/i;
export const LABELS = /^(?:contract|contractor|part-time|part time|freelance|temporary|internship|consulting|volunteer|own company|personal project)$/i;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DATE = `(?:${MON}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4}-\\d{2}(?!\\d)|(?:19|20)\\d{2})`;
const RANGE = () => new RegExp(`(${DATE})\\s*(?:–|—|-|to|until|through)\\s*(${DATE}|present|now|current|today)`, 'gi');

// A date as written ("Mar 2021", "March 2021", "3/2021", "2021-03", "2021") as "YYYY-MM" or "YYYY". "Present" is "".
export function toYm(written: string): string {
  const s = written.trim().replace(/\./g, '');
  if (/^(present|now|current|today)$/i.test(s)) return '';
  let m = /^([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) { const i = MONTHS.findIndex((x) => m![1].toLowerCase().startsWith(x.toLowerCase())); return i < 0 ? m[2] : `${m[2]}-${String(i + 1).padStart(2, '0')}`; }
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return s;
  return /^\d{4}$/.exec(s)?.[0] ?? '';
}
// "2021-03" as "Mar 2021"; a year alone stays a year.
export const monthText = (ym: string) => { const [y, m] = ym.split('-'); return m && MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : y; };
// A role's dates as a resume writes them; "" when the start is not known.
export const rangeText = (start: string, end: string) => (start === '' ? '' : `${monthText(start)} – ${end === '' ? 'Present' : monthText(end)}`);
// Two dates agree when they match to the precision both give: a year alone matches any month of it.
export const sameDate = (a: string, b: string) => (a === '' || b === '' ? a === b : a.length < 7 || b.length < 7 ? a.slice(0, 4) === b.slice(0, 4) : a === b);

export function rangesIn(text: string): Range[] {
  return [...text.matchAll(RANGE())].map((m) => ({ start: toYm(m[1]), end: toYm(m[2]), text: m[0] }));
}

const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S[^*_]*)[*_](?=\s|$|[.,;])/g, '$1$2').trim();
const unbullet = (s: string) => s.replace(/^\s*[-*•]\s+/, '').trim();

// "Title, Company" into its two parts. `companies` are employer names as the bank has them: with them a title
// that holds a comma ("Director, Software Engineering, Acme") or a company that does ("Acme, Inc.") still parts right.
export function splitHeading(text: string, companies: string[] = []): { title: string; company: string } {
  const t = clean(text), low = t.toLowerCase();
  for (const c of [...companies].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const cl = c.toLowerCase();
    if (low === cl) return { title: '', company: t };
    if (low.endsWith(`, ${cl}`)) return { title: t.slice(0, t.length - c.length - 2).trim(), company: t.slice(t.length - c.length) };
  }
  for (const sep of [', ', ' at ', ' @ ', ' | ', ' — ', ' – ', ' - ']) {
    const at = t.lastIndexOf(sep);
    if (at > 0) return { title: t.slice(0, at).trim(), company: t.slice(at + sep.length).trim() };
  }
  return { title: '', company: t };
}

const sectionOf = (name: string) => {
  const n = name.toLowerCase().replace(/[^a-z& ]/g, '').trim();
  if (/^(professional |career )?summary$|^profile$|^about( me)?$/.test(n)) return 'summary';
  if (/^(work |professional |relevant )?experience$|^employment( history)?$|^work history$/.test(n)) return 'experience';
  if (/^(earlier|previous|additional|prior|other) (experience|roles|career)$/.test(n)) return 'earlier';
  if (/^projects$|^(personal |selected |side )projects$/.test(n)) return 'projects';
  if (/^(technical |core )?skills$|^technologies$/.test(n)) return 'skills';
  if (/^education( (and|&) (certifications|training))?$/.test(n)) return 'education';
  return `other:${clean(name)}`;
};

const PREVIOUSLY = /^(?:previously|earlier(?: at [^:,]+)?|before that)[:,]?\s+(.*)$/i;
const dated = (text: string) => rangesIn(text).length > 0 || new RegExp(`^${DATE}\\b`, 'i').test(text);

// The line under a role's heading: date ranges, then labels and the place, parted by a middle dot or a bar.
function datesLine(text: string): { ranges: Range[]; labels: string[]; place: string } {
  const ranges: Range[] = [], labels: string[] = [], place: string[] = [];
  for (const part of clean(text).split(/\s+[·|•]\s+/).map((p) => p.trim()).filter(Boolean)) {
    const found = rangesIn(part);
    if (found.length) ranges.push(...found);
    else if (LABELS.test(part)) labels.push(part);
    else if (!new RegExp(`^${DATE}$`, 'i').test(part)) place.push(part);
  }
  return { ranges, labels, place: place.join(', ') };
}

function earlierItem(text: string, companies: string[]): Earlier {
  const ranges = rangesIn(text), one = ranges.length ? [] : [...text.matchAll(/\((\d{4})\)/g)].map((m) => ({ start: m[1], end: m[1], text: m[1] }));
  const cut = Math.min(...[text.indexOf('('), ranges[0] ? text.indexOf(ranges[0].text) : -1].filter((i) => i >= 0), text.length);
  return { text, ...splitHeading(text.slice(0, cut).replace(/[\s,(:]+$/, ''), companies), ranges: [...ranges, ...one] };
}

export function parseResume(markdown: string, companies: string[] = []): Resume {
  const out: Resume = { name: '', contact: '', summary: '', sections: [], experience: [], projects: [], elsewhere: [], earlier: [], earlierAt: [], skills: [], education: [], other: [], dated: [], unplaced: [], outline: [] };
  try {
    let section = '', entry: Entry | undefined;
    const summary: string[] = [], lines = lf(String(markdown ?? '')).split('\n');
    const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
    // A line all in bold with a dated line under it is a role's heading written without "###".
    const boldHeading = (i: number): string | undefined => {
      const m = /^(?:\*\*(.+?)\*\*|__(.+?)__)$/.exec(lines[i].trim()), next = lines.slice(i + 1).find((l) => l.trim() !== '')?.trim() ?? '';
      const name = m?.[1] ?? m?.[2];
      return name && !dated(clean(name)) && !/^#/.test(next) && !isBullet(next) && dated(clean(next)) ? name : undefined;
    };
    // A line with a date range that is no entry's own dates line: the facts check asks what it is.
    const stray = (text: string, i: number) => { if (rangesIn(clean(text)).length > 0) out.dated.push({ line: i, text: clean(unbullet(text)) }); };
    lines.forEach((raw, i) => {
      const text = raw.trim();
      if (text === '') return;
      const h = /^(#{1,6})\s+(.*)$/.exec(text), level = h ? h[1].length : 0;
      if (level === 1) {
        if (out.name === '' && section === '') { out.name = clean(h![2]); out.outline.push({ kind: 'name', text: out.name, line: i }); } else out.unplaced.push(text);
        return;
      }
      if (level === 2) { section = sectionOf(h![2]); out.sections.push(clean(h![2])); out.outline.push({ kind: 'header', text: clean(h![2]), line: i }); entry = undefined; return; }
      const bullet = isBullet(raw) ? /^\s*[-*•]\s+(.*)$/.exec(raw)![1].trim() : undefined;
      // In Education a heading is a degree, and in Skills it names a group: neither is a job.
      const head = section === 'education' || section === 'skills' || bullet !== undefined ? undefined : h ? h[2] : boldHeading(i);
      if (head !== undefined) {
        entry = { section, heading: clean(head), ...splitHeading(head, companies), ranges: [], labels: [], place: '', previously: [], notes: [], bullets: [], technologies: [], current: false, at: { heading: i, dates: -1, previously: [], technologies: [], lines: [i] } };
        (section === 'experience' ? out.experience : section === 'projects' ? out.projects : out.elsewhere).push(entry);
        out.outline.push({ kind: 'heading', text: entry.heading, line: i });
        return;
      }
      if (entry) {
        entry.at.lines.push(i);
        const tech = TECHNOLOGIES.exec(clean(bullet ?? text));
        if (tech) { entry.technologies.push(...tech[1].split(/\s*[,;·|•]\s*/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean)); entry.at.technologies.push(i); return; }
        if (bullet !== undefined) { entry.bullets.push(clean(bullet)); out.outline.push({ kind: 'bullet', text: clean(bullet), line: i }); return; }
        const before = PREVIOUSLY.exec(clean(text));
        if (before && rangesIn(before[1]).length > 0) {
          const ranges = rangesIn(before[1]);
          entry.previously.push({ title: before[1].slice(0, before[1].indexOf(ranges[0].text)).replace(/[\s,(:·]+$/, ''), ranges });
          entry.at.previously.push(i);
        } else if (entry.at.dates < 0 && entry.bullets.length === 0 && entry.notes.length === 0 && entry.previously.length === 0 && dated(clean(text))) {
          Object.assign(entry, datesLine(text));
          entry.at.dates = i;
          entry.current = entry.ranges.some((r) => r.end === '');
        } else { entry.notes.push(clean(text)); stray(text, i); }
        return;
      }
      if (section === '') { if (out.contact === '' && bullet === undefined) out.contact = text; else out.unplaced.push(text); stray(text, i); return; }
      if (section === 'summary') { if (summary.length === 0) out.outline.push({ kind: 'summary', text: clean(unbullet(text)), line: i }); summary.push(clean(unbullet(text))); return; }
      if (section === 'experience' || section === 'projects') { out.unplaced.push(text); stray(text, i); return; }
      if (section === 'earlier') { out.earlierAt.push(i); out.earlier.push(...unbullet(clean(text)).split(/\s*;\s*/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean).map((x) => earlierItem(x, companies))); return; }
      if (section === 'skills') { out.skills.push(...clean(unbullet(h ? h[2] : text)).replace(/^[A-Za-z][A-Za-z &/]{1,28}:\s+/, '').split(/\s*[,;·|•]\s*/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean)); stray(text, i); return; }
      if (section === 'education') { out.education.push(clean(unbullet(h ? h[2] : text))); return; }
      const name = section.slice(6);
      (out.other.find((o) => o.section === name) ?? out.other[out.other.push({ section: name, lines: [] }) - 1]).lines.push(text);
      stray(text, i);
    });
    out.summary = summary.join(' ');
  } catch (e) { out.unplaced.push(`The rest could not be read: ${(e as Error).message}`); }
  return out;
}

// The sentences of a summary, and its words. "Node.js" and "3.5" are not sentence ends.
export const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean);
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

// What a six-second skim takes in: the name, the summary, and the first role's title, company, dates and first two bullets.
export function skimView(r: Resume): string {
  const first = r.experience[0];
  return [`Name: ${r.name}`, `Summary: ${r.summary}`, first ? `First role: ${first.heading}` : 'First role: none',
    first ? `Dates: ${first.ranges.map((x) => x.text).join('; ') || 'not given'}${first.labels.length ? ` (${first.labels.join(', ')})` : ''}` : '',
    ...(first?.notes.slice(0, 1).map((n) => `Line under the dates: ${n}`) ?? []), ...(first?.bullets.slice(0, 2).map((b) => `- ${b}`) ?? [])].filter(Boolean).join('\n');
}

// Text as a run of plain words, so the Markdown and a PDF's extracted text can be compared: marks, dashes,
// bars and line breaks all become one space.
const flat = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[’'‘]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The parse test: does the text taken from the PDF hold the name, each section header, the summary, each role's
// title and company and each bullet, one after another in the Markdown's order? A long item is known by its
// first eight words. `missing` are items not in the text at all; `moved` are in it, but before their place.
export function readingOrder(markdown: string, text: string, companies: string[] = []): { ok: boolean; headers: string[]; missing: string[]; moved: string[] } {
  const hay = ` ${flat(text)} `, r = parseResume(markdown, companies);
  const items = r.outline.flatMap((o) => {
    if (o.kind !== 'heading') return [{ label: o.kind === 'header' ? `the ${o.text} header` : o.kind === 'name' ? 'the name' : o.kind === 'summary' ? 'the summary' : `the bullet “${o.text.split(' ').slice(0, 6).join(' ')}…”`, needle: o.text, header: o.kind === 'header' ? o.text : '' }];
    const { title, company } = splitHeading(o.text, companies);
    return [title, company].filter(Boolean).map((x) => ({ label: `the role heading “${o.text}”`, needle: x, header: '' }));
  });
  const headers: string[] = [], missing: string[] = [], moved: string[] = [];
  let at = 0;
  for (const it of items) {
    const needle = ` ${flat(it.needle).split(' ').slice(0, 8).join(' ')} `;
    if (needle.trim() === '') continue;
    const found = hay.indexOf(needle, at);
    if (found >= 0) { at = found + needle.length - 1; if (it.header) headers.push(it.header); }
    else (hay.includes(needle) ? moved : missing).push(it.label);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return { ok: missing.length === 0 && moved.length === 0, headers, missing: uniq(missing), moved: uniq(moved) };
}
