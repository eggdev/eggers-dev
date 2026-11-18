// The bank's roles as the entries a resume may show, and the check that a resume shows them truly.
// - Rows for the same employer are one entry with several date ranges or titles (rule 4).
// - Each entry has one true heading, dates line and "Earlier experience" form, built here from the data.
//   The writer is told to copy them, and a written resume is checked against them (rules 5, 9 and 10).
// - A resume a model wrote is repaired from the data where the match is certain. A resume the person
//   edited is never rewritten: the same findings are only reported.
// - The check covers every entry wherever it is written (any section but Education and Skills, and a bold
//   line used as a heading), every other line that holds a date range, and a resume with no job at all.
//   So a job the bank does not have cannot be stored by writing it somewhere else.
// This file opens no database and asks no model: the roles are passed in.
import type { RoleRow } from './db.ts';
import { lf, parseResume, rangeText, sameDate, type Entry, type Range, type Resume } from './resume.ts';

// One employer: its rows newest first, and the project groups filed under any of them.
export type Group = { key: string; company: string; rows: RoleRow[]; children: RoleRow[] };
export type Canon = { heading: string; dates: string; previously: string[]; note: string; earlier: string };
// was: what the resume says. is: what the bank says. fixable: the bank's value can be put back with no guess.
// loose: a dated line that is no entry, which may be a job or may not (a certificate): for a flag's weight.
// project: an entry or a dated line that is one of the record's projects of a role, written as a heading of its own.
// It changes only the words of the finding: what is accepted or refused is the same.
export type FactFinding = { kind: 'title' | 'employer' | 'dates' | 'unknown' | 'split'; entry: string; was: string; is: string; fixable: boolean; text: string; loose?: boolean; project?: string };

// A project of a role by name, with the role it belongs to in words ("Director of Engineering at Harborlight Systems").
// The caller reads them from the record (lib/checks.ts, projectNames): this file reads no database.
export type ProjectName = { name: string; role: string };
// The project of a role a heading or a dated line names, when it names one: for the words of a finding only.
function projectNamed(text: string, projects: ProjectName[]): ProjectName | undefined {
  if (projects.length === 0) return undefined;
  const t = norm(text.replace(/[*_#`]/g, ' ').replace(/\([^)]*\d{4}[^)]*\)/g, ' ').replace(/\b(?:[A-Z][a-z]{2} )?\d{4}\s*[–—-]\s*(?:(?:[A-Z][a-z]{2} )?\d{4}|present)\b/gi, ' ').replace(/[·,:]+\s*$/, ''));
  return t === '' ? undefined : projects.find((x) => norm(x.name) === t);
}
const asProject = (shown: string, p: { name: string; role: string }) =>
  `The resume has “${shown}” as a heading of its own. It is a project of ${p.role} in your record: its facts are bullets of that role, never an entry or a heading with dates of its own.`;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// "Acme", "ACME" and "Acme, Inc." are one employer. Nothing looser than this is merged: that would be a guess.
export const normCompany = (s: string) => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)$/, '').trim();
const endKey = (r: RoleRow) => (r.start !== '' && r.end === '' ? '9999-99' : r.end);
const newestFirst = (a: RoleRow, b: RoleRow) => endKey(b).localeCompare(endKey(a)) || b.start.localeCompare(a.start) || a.id - b.id;

// A row's label on the dates line: the person's own (Contract, Part-time), else Contract for contract work.
export const labelOf = (r: RoleRow) => (r.label ?? '').trim() || (r.standing === 'contract' ? 'Contract' : '');
// Work on the person's own company or their own project says so, so it is never read as an employer's.
const ownership = (r: RoleRow) => (r.standing === 'personal' ? 'Personal project' : r.standing === 'own' && !/founder|owner|proprietor/i.test(r.title) ? 'Own company' : '');

export function employers(roles: RoleRow[]): Group[] {
  const top = roles.filter((r) => r.part_of === null || !roles.some((p) => p.id === r.part_of));
  const groups = new Map<string, Group>();
  for (const r of top) {
    // A group with no job title (a repository's project) is never merged with another.
    const key = r.title.trim() === '' ? `role:${r.id}` : normCompany(r.company);
    const g = groups.get(key) ?? { key, company: r.company, rows: [], children: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.rows.sort(newestFirst);
    g.company = g.rows[0].company;
    g.children = roles.filter((c) => c.part_of !== null && g.rows.some((r) => r.id === c.part_of)).sort(newestFirst);
  }
  return [...groups.values()].sort((a, b) => newestFirst(a.rows[0], b.rows[0]));
}

const year = (ym: string) => ym.slice(0, 4);
export function canonical(g: Group): Canon {
  const head = g.rows[0], same = g.rows.filter((r) => norm(r.title) === norm(head.title));
  const ranges = (rows: RoleRow[]) => rows.map((r) => rangeText(r.start, r.end)).filter(Boolean).join('; ');
  const labels = (rows: RoleRow[]) => [...new Set(rows.map(labelOf).filter(Boolean))];
  const titles = [...new Map(g.rows.filter((r) => norm(r.title) !== norm(head.title)).map((r) => [norm(r.title), r.title])).values()];
  const dated = g.rows.filter((r) => r.start !== ''), from = dated.map((r) => year(r.start)).sort()[0] ?? '';
  const to = dated.some((r) => r.end === '') ? 'Present' : dated.map((r) => year(r.end)).sort().pop() ?? '';
  const heading = head.title.trim() ? `${head.title.trim()}, ${head.company.trim()}` : head.company.trim();
  return {
    heading,
    dates: [ranges(same), ...labels(same), ownership(head), head.location.trim()].filter(Boolean).join(' · '),
    previously: titles.map((t) => { const rows = g.rows.filter((r) => norm(r.title) === norm(t)); return [`Previously ${t}, ${ranges(rows)}`, ...labels(rows)].join(' · '); }),
    note: g.rows.map((r) => (r.note ?? '').trim()).find(Boolean) ?? '',
    earlier: `${heading}${from ? ` (${from === to ? from : `${from} – ${to}`})` : ''}`,
  };
}

const sameRange = (x: Range, r: RoleRow) => r.start !== '' && sameDate(x.start, r.start) && sameDate(x.end, r.end);
const rowRange = (r: RoleRow) => rangeText(r.start, r.end);

// Which employer an entry is: by its company, else by its title and dates when exactly one employer has both.
export function groupOf(title: string, company: string, ranges: Range[], groups: Group[]): { group?: Group; by: 'company' | 'title' | '' } {
  const c = normCompany(company || title);
  const named = groups.filter((g) => g.rows.some((r) => normCompany(r.company) === c));
  if (named.length === 1) return { group: named[0], by: 'company' };
  if (named.length === 0 && title !== '') {
    const alike = groups.filter((g) => g.rows.some((r) => norm(r.title) === norm(title) && ranges.some((x) => sameRange(x, r))));
    if (alike.length === 1) return { group: alike[0], by: 'title' };
  }
  return { by: '' };
}

type Seen = { entry: Entry; group?: Group; findings: FactFinding[] };

function examine(resume: Resume, groups: Group[], projects: ProjectName[] = []): { entries: Seen[]; earlier: { index: number; group?: Group; findings: FactFinding[] }[]; loose: FactFinding[] } {
  const taken = new Set<string>();
  // Every entry, in whatever section it was written, in the order of the page.
  const entries = [...resume.experience, ...resume.projects, ...resume.elsewhere].sort((a, b) => a.at.heading - b.at.heading).map((entry): Seen => {
    const all = [...entry.ranges, ...entry.previously.flatMap((p) => p.ranges)];
    const { group, by } = groupOf(entry.title, entry.company, all, groups);
    if (!group) {
      const p = projectNamed(entry.heading, projects);
      return { entry, findings: [{ kind: 'unknown', entry: entry.heading, was: entry.heading, is: '', fixable: false, ...(p ? { project: p.name } : {}),
        text: p ? asProject(entry.heading, p) : `The resume has an entry “${entry.heading}”. Your record has no job or project by that name, or with that title and those dates.` }] };
    }
    if (taken.has(group.key)) return { entry, group, findings: [{ kind: 'split', entry: entry.heading, was: entry.heading, is: canonical(group).heading, fixable: false, text: `${group.company} appears as two entries. One employer is one entry, with its date ranges and titles together.` }] };
    taken.add(group.key);
    const findings: FactFinding[] = [], titles = new Set(group.rows.map((r) => norm(r.title))), canon = canonical(group);
    if (by === 'title') findings.push({ kind: 'employer', entry: entry.heading, was: entry.company, is: group.company, fixable: true, text: `The resume names the employer “${entry.company}”. Your record says “${group.company}” for that title and those dates.` });
    for (const t of [entry.title, ...entry.previously.map((p) => p.title)]) {
      if (!titles.has(norm(t))) findings.push({ kind: 'title', entry: entry.heading, was: t || '(no title)', is: group.rows[0].title || '(no title)', fixable: true, text: `The resume gives the title “${t || 'none'}” at ${group.company}. Your record says “${[...new Set(group.rows.map((r) => r.title).filter(Boolean))].join('” and “') || 'no title'}”. A background check verifies titles.` });
    }
    const dated = group.rows.filter((r) => r.start !== '');
    const wrong = all.filter((x) => !dated.some((r) => sameRange(x, r))), left = dated.filter((r) => !all.some((x) => sameRange(x, r)));
    if (dated.length > 0 && (wrong.length > 0 || left.length > 0)) {
      findings.push({ kind: 'dates', entry: entry.heading, was: all.map((x) => x.text).join('; ') || '(no dates)', is: dated.map(rowRange).join('; '), fixable: true, text: `The resume gives ${all.length ? `the dates ${all.map((x) => x.text).join('; ')}` : 'no dates'} for ${canon.heading}. Your record says ${dated.map(rowRange).join('; ')}.` });
    }
    return { entry, group, findings };
  });
  const earlier = resume.earlier.map((item, index) => {
    const { group } = groupOf(item.title, item.company, item.ranges, groups);
    if (!group) return { index, findings: [{ kind: 'unknown' as const, entry: item.text, was: item.text, is: '', fixable: false, text: `The Earlier experience line lists “${item.text}”. Your record has no job with that employer.` }] };
    const findings: FactFinding[] = [], canon = canonical(group), dated = group.rows.filter((r) => r.start !== '');
    if (!group.rows.some((r) => norm(r.title) === norm(item.title))) findings.push({ kind: 'title', entry: item.text, was: item.title || '(no title)', is: group.rows[0].title, fixable: true, text: `The Earlier experience line gives the title “${item.title || 'none'}” at ${group.company}. Your record says “${group.rows[0].title}”.` });
    const span: Range = { start: dated.map((r) => r.start).sort()[0] ?? '', end: dated.some((r) => r.end === '') ? '' : dated.map((r) => r.end).sort().pop() ?? '', text: '' };
    const fits = (x: Range) => dated.some((r) => sameRange(x, r)) || (sameDate(x.start.slice(0, 4), span.start.slice(0, 4)) && sameDate(x.end.slice(0, 4), span.end.slice(0, 4)));
    if (dated.length > 0 && item.ranges.some((x) => !fits(x))) findings.push({ kind: 'dates', entry: item.text, was: item.ranges.map((x) => x.text).join('; '), is: canon.earlier, fixable: true, text: `The Earlier experience line gives ${item.ranges.map((x) => x.text).join('; ')} for ${canon.heading}. Your record says ${dated.map(rowRange).join('; ')}.` });
    return { index, group, findings };
  });
  // A line with a date range that is not an entry's own dates line, a bullet under an entry, or the person's note.
  const notes = new Set(groups.map((g) => norm(canonical(g).note)).filter(Boolean));
  const loose = resume.dated.filter((d) => !notes.has(norm(d.text))).map((d): FactFinding => {
    const p = projectNamed(d.text, projects);
    return { kind: 'unknown', entry: d.text, was: d.text, is: '', fixable: false, loose: true, ...(p ? { project: p.name } : {}),
      text: p ? asProject(d.text, p) : `The resume has a line with dates that is not under one of the jobs in your record: “${d.text}”. If it is a job, your record does not have it.` };
  });
  // No job at all, when the bank has jobs.
  if (resume.experience.length === 0 && groups.some((g) => g.rows.some((r) => r.title.trim() !== '' && r.standing !== 'personal'))) {
    loose.push({ kind: 'unknown', entry: '', was: '', is: '', fixable: false, text: 'The resume lists no job under Experience, and your record has jobs.' });
  }
  return { entries, earlier, loose };
}
const findingsOf = (seen: ReturnType<typeof examine>) => [...seen.entries.flatMap((s) => s.findings), ...seen.earlier.flatMap((s) => s.findings), ...seen.loose];

// Every difference between a resume and the bank's roles: a title, employer or date that differs, an entry the
// bank does not have, a dated line that is no entry, or no job at all.
// `projects`: the record's projects of roles, so a project written as a heading is named as one (words only).
export function checkEntries(markdown: string, roles: RoleRow[], projects: ProjectName[] = []): FactFinding[] {
  return findingsOf(examine(parseResume(markdown, roles.map((r) => r.company)), employers(roles), projects));
}

// For a resume a model wrote. Each entry that is certainly one of the bank's employers gets its heading, dates line,
// "Previously" lines and context note written from the data, whatever the model wrote there. `repaired` lists
// where that changed a fact (not only its formatting). `unresolved` is everything else: an entry or a dated line
// that matches nothing in the bank, the same employer twice, and anything the repaired text still gets wrong
// when it is checked again. Nothing true can be put back for those, so the caller must not keep this version.
export function repairEntries(markdown: string, roles: RoleRow[], projects: ProjectName[] = []): { resume: string; repaired: FactFinding[]; unresolved: FactFinding[] } {
  const text = lf(markdown), resume = parseResume(text, roles.map((r) => r.company)), seen = examine(resume, employers(roles), projects);
  // Each change is a splice at a line number of the text as it was read. They are applied from the bottom of the
  // file up, so no change moves a line that a later one names, wherever the sections sit.
  const edits: { at: number; remove: number; insert: string[] }[] = [];
  if (resume.earlierAt.length > 0 && seen.earlier.some((e) => e.group)) {
    const items = seen.earlier.map((e) => (e.group ? canonical(e.group).earlier : resume.earlier[e.index].text));
    edits.push({ at: resume.earlierAt[0], remove: resume.earlierAt[resume.earlierAt.length - 1] - resume.earlierAt[0] + 1, insert: [[...new Set(items)].join('; ')] });
  }
  for (const s of seen.entries) {
    if (!s.group || s.findings.some((f) => !f.fixable)) continue;
    const canon = canonical(s.group), at = s.entry.at, has = (line: string) => s.entry.notes.some((n) => norm(n) === norm(line));
    for (const i of at.previously) edits.push({ at: i, remove: 1, insert: [] });
    // The place is the bank's when it has one, else the one the writer gave.
    const dates = s.group.rows[0].location.trim() === '' && s.entry.place !== '' ? [canon.dates, s.entry.place].filter(Boolean).join(' · ') : canon.dates;
    const under = [dates, ...canon.previously, ...(canon.note && !has(canon.note) ? [canon.note] : [])].filter(Boolean);
    // With no dates line to replace, a line the entry already has is not put in twice.
    if (at.dates >= 0) edits.push({ at: at.dates, remove: 1, insert: under }); else edits.push({ at: at.heading + 1, remove: 0, insert: under.filter((l) => !has(l)) });
    edits.push({ at: at.heading, remove: 1, insert: [`### ${canon.heading}`] });
  }
  const lines = text.split('\n');
  // From the bottom up. Two changes at one line number: the insertion (which removes nothing) goes in last, so it lands above.
  for (const e of edits.sort((a, b) => b.at - a.at || b.remove - a.remove)) lines.splice(e.at, e.remove, ...e.insert);
  const fixed = lines.join('\n'), first = findingsOf(seen), left = checkEntries(fixed, roles, projects);
  const unresolved = [...first.filter((f) => !f.fixable), ...left.filter((f) => !first.some((x) => !x.fixable && x.text === f.text))];
  return { resume: fixed, repaired: first.filter((f) => f.fixable), unresolved };
}

// Entries with no bullets under them, as the resume names them (rule 4: such an entry is never shown).
export const emptyEntries = (resume: Resume) => resume.experience.filter((e) => e.bullets.length === 0).map((e) => e.heading);

// For a resume a model wrote: an entry with no bullets is taken out and named on the one-line "Earlier
// experience" section instead, in the bank's own words. An entry that matches no employer is left for the check.
export function collapseEmpty(written: string, roles: RoleRow[]): string {
  const markdown = lf(written), resume = parseResume(markdown, roles.map((r) => r.company)), groups = employers(roles);
  const empty = resume.experience.filter((e) => e.bullets.length === 0)
    .map((e) => ({ e, group: groupOf(e.title, e.company, [...e.ranges, ...e.previously.flatMap((p) => p.ranges)], groups).group })).filter((x) => x.group);
  if (empty.length === 0) return markdown;
  const gone = new Set(empty.flatMap((x) => x.e.at.lines)), add = empty.map((x) => canonical(x.group!).earlier);
  const lines = markdown.split('\n');
  if (resume.earlierAt.length > 0) {
    const have = lines[resume.earlierAt[0]].replace(/\.\s*$/, '');
    lines[resume.earlierAt[0]] = [have, ...add.filter((a) => !have.includes(a))].join('; ');
  } else {
    const start = resume.outline.find((o) => o.kind === 'header' && /experience/i.test(o.text))?.line ?? -1;
    const next = resume.outline.find((o) => o.kind === 'header' && o.line > start)?.line ?? lines.length;
    // Put after the last entry. Every line taken out below sits above this point, so its number is unchanged.
    lines.splice(next, 0, '## Earlier experience', '', add.join('; '), '');
  }
  return lines.filter((_, i) => !gone.has(i)).join('\n').replace(/\n{3,}/g, '\n\n');
}
