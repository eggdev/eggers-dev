// Rule 7, "The resume is the screen": a job's resume as rows, each with the facts its line uses and the notes that
// concern it, for the screen at /job/:id/resume (GET /jobs/:id/resume). Everything here is read from what is stored:
// the text, its links (lib/links.ts), its flags (lib/checks.ts, each placed by its `at`), the questions still open about
// the record (lib/raised.ts), the readers' weak lines of the council (lib/council.ts), the versions (lib/versions.ts) and
// the posting map. No model is asked, and nothing is written.
//
// The owner's record is taken as the owner gave it (DESIGN.md rule 4): a fact opened beside a line shows its reference,
// its words, its number, where it sits in the record and its dates, and never where it was read from, when it was added,
// a status, or how sure it is. A link is the writer's statement of which facts a line uses, checked by code for what code
// can check (lib/links.ts); it is never called verified.
//
// Each note is worded for the owner, beside the line it concerns: it never quotes that line, never tells a writer what to
// do, and never shows an internal key. The stored flags and the job page keep their own words. A reference this screen
// builds (F-, R-, P-, J-, V-) never breaks at its hyphen: it carries a non-breaking hyphen (U+2011). The owner's words and
// a model's words keep their own hyphens ("F-16", "V-8").
import { db, type RoleRow } from './db.ts';
import { checkEntries, employers, groupOf, normCompany, type Group } from './entries.ts';
import type { Analysis, JobRow, Requirement } from './jobs.ts';
import { checkLinks, linkFinder, linksOn, parseLinks, places, type CitedFact, type LinkFinding, type LinkLine, type Links } from './links.ts';
import { homeKeys } from './queue.ts';
import { openRaised, routeOf, type Raised } from './raised.ts';
import { lf, parseResume, rangeText, type Entry, type Resume } from './resume.ts';
import { factRef, levelOf, placeOf, projectRef, roleRef, type ProjectRow } from './tree.ts';
import { versionsOf } from './versions.ts';
import { projectNames, sigOf, versionNames, type Flag } from './checks.ts';
import { shownSuggestions, WORD, wordDiff, type Part } from './suggest.ts';

// kind: fail (a failed check), flag, suggestion (the reason for a suggestion on the line), question, or note (said
// about the line, not a fault: the owner edited or wrote it).
export type Note = { id: string; kind: 'fail' | 'flag' | 'suggestion' | 'question' | 'note'; lead: string; text: string; route: string; action: string };
// A suggestion on a line of a resume the owner edited (lib/suggest.ts): open, or decided (kept, rejected) so the screen
// can offer Undo. parts: the line's words as the difference of its old and new words, in the order they are read.
export type RowSug = { id: string; status: 'open' | 'kept' | 'rejected'; word: string; parts: { id: string; kind: Part['kind']; text: string; gap: boolean }[] };
// A reference beside a line: a fact it uses ("fact"), or the role or project a heading is about ("role").
// gone: the fact is no longer in the record.
export type RowRef = { id: string; code: string; kind: 'fact' | 'role'; fact: string; gone: boolean };
export type Row = { id: string; kind: 'name' | 'contact' | 'section' | 'role' | 'dates' | 'para' | 'bullet' | 'item' | 'plain'; text: string; refs: RowRef[]; notes: Note[]; sugs: RowSug[] };
export type FactCard = { id: string; code: string; text: string; number: string; place: string; when: string };
export type ReqLine = { id: string; text: string; note: string };
// answered and asked: what the reading of the record found (coverage), as the job page counts it. open: what nothing in
// the record answers. more: requirements the record has more for than this resume uses.
export type Balance = { answered: number; asked: number; open: ReqLine[]; more: ReqLine[] };
export type Change = { id: string; letter: string; date: string; text: string };
export type ResumeView = { ref: string; version: string; letter: string; date: string; changes: Change[];
  title: string; company: string; pdf: string; edited: boolean; linked: boolean; legacy: string; balance: Balance; whole: Note[]; rows: Row[]; facts: FactCard[] };

export const LEGACY_LINE = 'The studio has no record of which facts each line of this resume uses. Write it again to record them.';
export const MORE_LINE = 'Your record has more for these requirements than this resume uses:';
// A suggestion's reason comes first on its row, so the cap of notes never hides it (one suggestion stands on a line).
const RANK: Record<Note['kind'], number> = { suggestion: 0, fail: 1, flag: 2, question: 3, note: 4 };
const pad = (id: number, n: number) => String(id).padStart(n, '0');
export const jobRef = (id: number) => `J-${pad(id, 3)}`;
// A reference this screen builds, made so that it never breaks at a hyphen. Never applied to the owner's or a model's words.
export const nb = (code: string) => code.replaceAll('-', '‑');
const fRef = (id: number) => nb(factRef(id)), pRef = (id: number) => nb(projectRef(id));
export const NAMES_NONE = 'This line names no fact of your record.';
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const day = (t: number) => (t > 0 ? DAY.format(t) : '');
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const short = (s: string, most = 90) => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// The words of a line as the page sets them: no Markdown marks, a link's words without its address.
const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S[^*_]*)[*_](?=\s|$|[.,;])/g, '$1$2').trim();
const parseAnalysis = (s: string): Partial<Analysis> => { try { const a = s ? JSON.parse(s) : {}; return a && typeof a === 'object' ? a : {}; } catch { return {}; } };
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

type Facts = Map<number, CitedFact & { project_id: number | null }>;
type Rec = { roles: RoleRow[]; groups: Group[]; projects: ProjectRow[]; facts: Facts; companies: string[] };
function readRecord(): Rec {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const facts: Facts = new Map((db.query('SELECT id, role_id, project_id, text, detail, metric, baseline, team, own_part, skills FROM facts').all() as (CitedFact & { project_id: number | null })[]).map((f) => [f.id, f]));
  return { roles, groups: employers(roles), projects: db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[], facts, companies: roles.map((r) => r.company) };
}

// ---------- Where a fact or a row sits, in the words and references Experience uses ----------

// A row's own reference: R- for a role, P- for the project that carries a repository's or a side project's row (none
// when it has no project yet).
function rowRef(row: RoleRow, rec: Rec): string {
  if (levelOf(row, rec.roles) === 'role') return nb(roleRef(row.id));
  const p = rec.projects.find((x) => x.via_role === row.id);
  return p ? pRef(p.id) : '';
}
// A row in words: "R-01 Platform Engineer, Tamarack Analytics", "P-040 Tidewater, a side project",
// "P-041 depot-sync, under Quillfeather Labs", "P-042 avery/sketchbook, not yet placed".
function rowWords(row: RoleRow, rec: Rec): string {
  const ref = rowRef(row, rec), named = (s: string) => (ref ? `${ref} ${s}` : s), level = levelOf(row, rec.roles);
  if (level === 'role') return named(row.title ? `${row.title}, ${row.company}` : row.company);
  if (level === 'side') return named(`${row.company}, a side project`);
  if (level === 'project') { const up = rec.roles.find((r) => r.id === row.part_of); return named(`${row.company}${up ? `, under ${up.company}` : ''}`); }
  return named(`${row.company}, not yet placed`);
}
// A fact's place: its project in its role, or its role (or its row) alone.
function factWords(f: { role_id: number | null; project_id: number | null }, rec: Rec): string {
  const row = f.role_id === null ? undefined : rec.roles.find((r) => r.id === f.role_id);
  if (!row) return 'General, in no role';
  const p = f.project_id === null ? undefined : rec.projects.find((x) => x.id === f.project_id && x.via_role === null);
  return p ? `${pRef(p.id)} ${p.title}, in ${rowWords(row, rec)}` : rowWords(row, rec);
}

// The rows of the record an entry of the resume is about: the rows of its employer (as entries.ts resolves it, by company,
// or by title and dates) whose title is the entry's title or one of its "Previously" titles. A title the record lacks (the
// owner edited it) is the employer's row its dates overlap most, when that covers a third of the heading's own months at
// least; with no dates, the entry's own title is the employer's newest row; other dates name none.
const month = (ym: string, end: boolean) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m ? m - 1 : end ? 11 : 0); };
const NOW = () => { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const span = (start: string, end: string): [number, number] | undefined => (/^\d{4}/.test(start) ? [month(start, false), end === '' ? NOW() : month(end, true)] : undefined);
function overlapping(rows: RoleRow[], ranges: Entry['ranges']): RoleRow[] {
  const over = (r: RoleRow) => { const a = span(r.start, r.end); return a ? ranges.reduce((n, x) => { const b = span(x.start, x.end); return n + (b ? Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1) : 0); }, 0) : 0; };
  // The heading's own months: a role it only touches (a month at one end) is not the role it is about.
  const own = ranges.reduce((n, x) => { const b = span(x.start, x.end); return n + (b ? Math.max(0, b[1] - b[0] + 1) : 0); }, 0);
  const best = Math.max(0, ...rows.map(over));
  return best > 0 && best * 3 >= own ? rows.filter((r) => over(r) === best).slice(0, 1) : [];
}
function rowsOfEntry(e: { title: string; company: string; ranges: Entry['ranges']; previously?: Entry['previously'] }, rec: Rec): RoleRow[] {
  const all = [...e.ranges, ...(e.previously ?? []).flatMap((p) => p.ranges)];
  const g = groupOf(e.title, e.company, all, rec.groups).group;
  if (!g) return [];
  const rows = [...g.rows, ...g.children], about = new Set<RoleRow>();
  const titled = (t: string) => rows.filter((r) => same(t, r.title));
  const own = titled(e.title);
  for (const r of own.length ? own : e.ranges.length ? overlapping(g.rows, e.ranges) : g.rows.slice(0, 1)) about.add(r);
  for (const p of e.previously ?? []) { const t = titled(p.title); for (const r of t.length ? t : overlapping(g.rows, p.ranges)) about.add(r); }
  return rows.filter((r) => about.has(r));
}
// Every row of the record the resume shows (`all`): an entry in any section, or an item of the Earlier experience line.
// Each brings its employer's rows with it (a repository filed under it is shown with it). `experience`: the rows shown
// by an entry of Experience, the only one whose bullets carry links (lib/links.ts, places).
function shownRows(r: Resume, rec: Rec): { all: Set<number>; experience: Set<number> } {
  const all = new Set<number>(), experience = new Set<number>();
  const take = (into: Set<number>[], title: string, company: string, ranges: Entry['ranges']) => { const g = groupOf(title, company, ranges, rec.groups).group; if (g) for (const x of [...g.rows, ...g.children]) for (const s of into) s.add(x.id); };
  for (const e of r.experience) take([all, experience], e.title, e.company, [...e.ranges, ...e.previously.flatMap((p) => p.ranges)]);
  for (const e of [...r.projects, ...r.elsewhere]) take([all], e.title, e.company, [...e.ranges, ...e.previously.flatMap((p) => p.ranges)]);
  for (const e of r.earlier) take([all], e.title, e.company, e.ranges);
  return { all, experience };
}

// ---------- The rows ----------

type Place = { where: 'summary' | 'bullet' | 'role'; entry: string; text: string };
type Built = Omit<Row, 'sugs'> & { sugs?: RowSug[]; place?: Place; roleIds?: number[] };

function rowsOf(markdown: string, r: Resume, rec: Rec): Built[] {
  const lines = lf(markdown).split('\n'), kind = new Map<number, Built>();
  const set = (i: number, b: Omit<Built, 'id' | 'refs' | 'notes'>) => kind.set(i, { id: String(i), refs: [], notes: [], ...b });
  for (const o of r.outline) {
    if (o.kind === 'name') set(o.line, { kind: 'name', text: o.text });
    if (o.kind === 'header') set(o.line, { kind: 'section', text: o.text });
  }
  const { places: ps, summary } = places(markdown, rec.companies);
  for (const i of summary) set(i, { kind: 'para', text: plain(lines[i]), place: { where: 'summary', entry: '', text: r.summary } });
  for (const p of ps) if (p.where === 'bullet') set(p.line, { kind: 'bullet', text: p.text, place: { where: 'bullet', entry: p.entry, text: p.text } });
  for (const e of [...r.experience, ...r.projects, ...r.elsewhere]) {
    const about = rowsOfEntry(e, rec);
    const b: Built = { id: String(e.at.heading), kind: 'role', text: e.heading, refs: [], notes: [], place: { where: 'role', entry: normCompany(e.company || e.title), text: e.heading }, roleIds: about.map((x) => x.id) };
    about.forEach((x, k) => { const code = rowRef(x, rec); if (code) b.refs.push({ id: `r${k}`, code, kind: 'role', fact: '', gone: false }); });
    kind.set(e.at.heading, b);
    if (e.at.dates >= 0) set(e.at.dates, { kind: 'dates', text: plain(lines[e.at.dates]) });
  }
  let seenName = false, contactDone = false;
  return lines.map((l, i) => {
    const t = l.trim();
    if (t === '') return undefined;
    const known = kind.get(i);
    if (known?.kind === 'name') seenName = true;
    if (known) { if (known.kind === 'section') contactDone = true; return known; }
    if (seenName && !contactDone) { contactDone = true; return { id: String(i), kind: 'contact', text: plain(t), refs: [], notes: [] } as Built; }
    const item = /^[-*•]\s+(.*)$/.exec(t);
    return { id: String(i), kind: item ? 'item' : 'plain', text: plain(item ? item[1] : t.replace(/^#+\s+/, '')), refs: [], notes: [] } as Built;
  }).filter((x): x is Built => x !== undefined);
}

// The link of each line, walking the page in order with the one lookup the checks use (lib/links.ts, linkFinder): two
// lines of the same words each take their own.
function linksOfRows(markdown: string, links: Links, companies: string[]): Map<number, LinkLine> {
  const find = linkFinder(links), out = new Map<number, LinkLine>();
  for (const p of places(markdown, companies).places) { const l = find(p); if (l) out.set(p.line, l); }
  return out;
}

// ---------- The balance (plan section 7) ----------

// "N of M requirements answered · K open" is what the reading of the record found (`coverage`), as the job page has
// always counted it: open means nothing in the record answers it. Separately, from stored data and no model, the
// requirements the record has more for than this resume uses: its strongest evidence is in a role or project the resume
// does not show, or (with links) a fact of a job Experience shows that no bullet under that job uses. A fact whose work is
// shown only outside Experience (Projects, the Earlier line, another section) is not said: those lines carry no links, so
// whether one uses it is not known. A best fact deleted since is not mentioned. Whether the resume's words answer a requirement some other way is not known to code, so none of this
// calls a requirement open.
export function balanceOf(job: Pick<JobRow, 'resume' | 'analysis'> & { links?: string }, rec: Rec = readRecord()): Balance {
  const reqs = list<Requirement>(parseAnalysis(job.analysis).requirements).filter((q) => q && typeof q === 'object');
  const open: ReqLine[] = [], more: ReqLine[] = [];
  const answered = reqs.filter((q) => q.coverage !== 'none').length;
  reqs.forEach((q, i) => { if (q.coverage === 'none') open.push({ id: String(i), text: String(q.text ?? ''), note: 'Nothing in your record answers it yet.' }); });
  const resume = job.resume ?? '';
  if (resume.trim() === '') return { answered, asked: reqs.length, open, more };
  const r = parseResume(resume, rec.companies), shown = shownRows(r, rec), links = parseLinks(job.links);
  // A fact counts as used only on a bullet that still stands under an entry of the fact's own employer.
  const used = new Set<number>();
  if (links) {
    const byLine = linksOfRows(resume, links, rec.companies);
    for (const p of places(resume, rec.companies).places) {
      const l = byLine.get(p.line);
      if (!l || p.where !== 'bullet') continue;
      const g = rec.groups.find((x) => x.rows.some((row) => normCompany(row.company) === p.entry));
      for (const f of l.facts) { const fact = rec.facts.get(f); if (fact && g && [...g.rows, ...g.children].some((row) => row.id === fact.role_id)) used.add(f); }
    }
  }
  reqs.forEach((q, i) => {
    if (q.coverage === 'none') return;
    const best = String(q.best ?? '').trim(), text = String(q.text ?? '');
    const fact = /^fact:(\d+)$/.exec(best), role = /^role:(\d+)$/.exec(best);
    if (fact) {
      const f = rec.facts.get(Number(fact[1]));
      if (!f || f.role_id === null) return;
      if (!shown.all.has(f.role_id)) more.push({ id: String(i), text, note: `${fRef(f.id)}, in ${factWords(f, rec)}, which this resume does not show.` });
      else if (links && shown.experience.has(f.role_id) && !used.has(f.id)) {
        // The entry is the fact's employer: a job, or a side project or repository shown as an entry of its own.
        const g = rec.groups.find((x) => [...x.rows, ...x.children].some((row) => row.id === f.role_id)), head = g?.rows[0];
        more.push({ id: String(i), text, note: `${fRef(f.id)}, in ${factWords(f, rec)}. No bullet under that ${!head || levelOf(head, rec.roles) === 'role' ? 'job' : 'project'} uses it.` });
      }
    } else if (role) {
      const row = rec.roles.find((x) => x.id === Number(role[1]));
      if (row && !shown.all.has(row.id)) more.push({ id: String(i), text, note: `${rowWords(row, rec)}, which this resume does not show.` });
    }
  });
  return { answered, asked: reqs.length, open, more };
}

// ---------- Notes, worded for the owner ----------

const note = (kind: Note['kind'], text: string, route = '', action = ''): Omit<Note, 'id'> => ({ kind, lead: kind === 'fail' ? 'Failed check' : kind === 'flag' ? 'Flag' : kind === 'suggestion' ? 'Suggestion' : kind === 'question' ? 'Question' : '', text, route, action });

// A stored flag's words beside its own line.
function flagWords(f: Flag, at: { item?: string; facts?: number[] }): string {
  const items = list<string>(f.items);
  switch (f.kind) {
    case 'tense': return 'This bullet opens in the wrong tense for the job: the present tense is for your current job, the past tense for the others.';
    case 'metrics-dropped': return at.item ? `This resume leaves out a measured result your record holds for this job: ${at.item}${at.facts?.length ? ` (${at.facts.map((x) => fRef(x)).join(', ')})` : ''}.` : f.text;
    case 'number-mark': return 'A number is missing here: no fact of your record holds it.';
    case 'link-mark': return 'A stray mark is printed in this line. Edit the line to take it out, or write the resume again.';
    case 'context-number': return items.length ? `${andList(items)} ${items.length === 1 ? 'is' : 'are'} in your record only in a project’s background, not in a fact.` : 'A number here is in your record only in a project’s background, not in a fact.';
    case 'kept-line': return 'This line repeats a line of How you work. Those lines are not facts.';
    case 'zero-bullets': return 'This job has no bullets under it. Give it one, or name it on the Earlier experience line.';
    case 'old-role': {
      const m = /ended (\d+) years ago and has (\d+) bullets/.exec(f.text);
      return m ? `This job ended ${m[1]} years ago and has ${m[2]} bullets. A job that old gets one bullet at most, or a place on the Earlier experience line.` : 'A job that old gets one bullet at most, or a place on the Earlier experience line.';
    }
    default: return f.text;
  }
}
// The findings of the links' check, beside their line (the stored ones are worded for the writer).
function linkWords(x: LinkFinding, rec: Rec): Omit<Note, 'id'>[] {
  const d = x.data ?? {};
  if (x.kind === 'link-number') {
    const nums = d.numbers ?? [], says = (d.facts ?? []).map((id) => rec.facts.get(id)).filter((f) => f !== undefined).map((f) => `${fRef(f.id)} says “${short(f.text)}${f.metric ? ` (${f.metric})` : ''}”.`);
    return [note('fail', `${andList(nums)} ${nums.length === 1 ? 'is' : 'are'} in none of the facts this line uses.${says.length ? ` ${says.join(' ')}` : ''}`)];
  }
  if (x.kind === 'link-elsewhere') return (d.facts ?? []).map((id, k) => note('fail', d.under?.[k] ? `${fRef(id)} is in your record under ${d.under[k]}, not under this job.` : `${fRef(id)} belongs to no job in your record, not to this one.`));
  // A line that names no fact: none in its link, or only keys that are no fact. The view says it only on a row whose
  // gutter shows no fact: a line whose facts are of another job, or gone, has the note of each fact and no other.
  if (x.kind === 'unlinked' && x.severity !== 'info') return [note('flag', NAMES_NONE)];
  // A fact gone is said with its reference, from the gutter; a line the owner wrote is said in grey.
  return [];
}
// The findings on a heading: what the record says, never quoting the heading. A title is said with both: the title of
// this heading or of its "Previously" line (`was`), and the record's (`is`).
function entryWords(kind: string, was: string, is: string, project: boolean): string {
  if (project) return 'Your record has this as a project of a role, not a job. Its work goes in that role’s bullets.';
  if (kind === 'title') return `${was === '(no title)' ? 'This resume gives no title here.' : `This resume gives the title “${was}” here.`} ${is === '(no title)' ? 'Your record has no title at this employer.' : `Your record has “${is}” at this employer.`}`;
  if (kind === 'employer') return `Your record names the employer “${is}” for this title and these dates.`;
  if (kind === 'dates') return `Your record gives the dates as ${is}.`;
  if (kind === 'split') return 'This employer appears in two entries. One employer is one entry.';
  return 'Your record has no job or project by this name, or with this title and these dates.';
}

// Where a question is answered, in words that match where the action goes: Home, while Home's list holds it; else the
// item in Experience where it is settled; else the fact, role or project it is about (a row that is no role, such as a
// repository nobody placed, is its project's place); else Experience's list of questions.
function questionAction(q: Raised, home: Set<string>, rec: Rec): { route: string; action: string } {
  if (home.has(q.key)) return { route: '/', action: 'Answer it on Home' };
  const settled = routeOf(q);
  if (settled !== '') return { route: settled, action: 'Answer it in Experience' };
  const about = q.about.split(',').map((x) => x.trim());
  const fact = about.map((x) => /^fact:(\d+)$/.exec(x)).find((m) => m !== null), role = about.map((x) => /^role:(\d+)$/.exec(x)).find((m) => m !== null);
  if (fact) return { route: `/record/fact/${fact[1]}`, action: 'Open the fact in Experience' };
  const row = role ? rec.roles.find((x) => x.id === Number(role[1])) : undefined;
  if (row && levelOf(row, rec.roles) !== 'role') {
    const p = rec.projects.find((x) => x.via_role === row.id);
    return p ? { route: `/record/project/${p.id}`, action: 'Open the project in Experience' } : { route: '/record', action: 'See the questions in Experience' };
  }
  if (role) return { route: `/record/role/${role[1]}`, action: 'Open the role in Experience' };
  return { route: '/record', action: 'See the questions in Experience' };
}

// ---------- The view ----------

export function resumeView(jobId: number): ResumeView | null {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as (JobRow & { links: string; edited: number }) | null;
  if (!job) return null;
  const a = parseAnalysis(job.analysis), rec = readRecord(), resume = job.resume ?? '';
  const links: Links | null = parseLinks(job.links), r = parseResume(resume, rec.companies);
  const rows = resume.trim() === '' ? [] : rowsOf(resume, r, rec);
  const byLine = links && rows.length ? linksOfRows(resume, links, rec.companies) : new Map<number, LinkLine>();
  const summaryRow = rows.find((x) => x.kind === 'para');
  const whole: Omit<Note, 'id'>[] = [];
  const add = (b: Built | undefined, n: Omit<Note, 'id'>) => { if (b) { if (!b.notes.some((x) => x.text === n.text)) b.notes.push({ id: '', ...n }); } else if (!whole.some((x) => x.text === n.text)) whole.push(n); };
  const rowOfLine = new Map(rows.map((b) => [Number(b.id), b]));
  // The row a place stands on: the summary's first line, or the line itself.
  const rowOfPlace = (line: number, where: string) => (where === 'summary' ? summaryRow : rowOfLine.get(line));
  const placesNow = rows.length ? places(resume, rec.companies).places : [];

  // The facts each line uses, in the gutter; a line edited or written by the owner says so; a fact gone says so.
  const used = new Set<number>();
  for (const p of placesNow) {
    const l = byLine.get(p.line), b = rowOfPlace(p.line, p.where);
    if (!l || !b) continue;
    for (const [k, f] of l.facts.entries()) {
      const gone = !rec.facts.has(f);
      b.refs.push({ id: `f${k}`, code: fRef(f), kind: 'fact', fact: gone ? '' : String(f), gone });
      if (gone) add(b, note('fail', `${fRef(f)} is no longer in your record.`)); else used.add(f);
    }
    if (l.edited > 0 && l.facts.length > 0) add(b, note('note', `You edited this line on ${SHORT.format(l.edited)}. It used ${andList(l.facts.map((f) => fRef(f)))} before your edit.`));
    else if (l.edited > 0) add(b, note('note', 'You wrote this line.'));
  }

  // The links' check, run now with the facts as they are, worded for the owner on its line.
  if (links && linksOn() && rows.length) {
    const found = checkLinks(resume, links, { facts: [...rec.facts.values()], roles: rec.roles, versions: versionNames() }).findings;
    for (const x of found) {
      const b = rowOfPlace(x.place.line, x.place.where);
      if (x.kind === 'unlinked' && b?.refs.some((r) => r.kind === 'fact')) continue;
      for (const n of linkWords(x, rec)) add(b, n);
    }
  }

  // The suggestions shown on this resume (lib/suggest.ts). While one is open, the finding it answers is not said again:
  // the title or employer finding of its heading, or the dates finding of its entry (placed on the heading).
  const sugsNow = rows.length ? shownSuggestions(job) : [];
  const answered = new Set<string>(), lines = resume.split('\n'), entries = [...r.experience, ...r.projects, ...r.elsewhere];
  for (const x of sugsNow.filter((q) => q.status === 'open')) {
    const at = lines.indexOf(x.old);
    const e = entries.find((q) => (x.where_ === 'dates' ? q.at.dates : q.at.heading) === at);
    if (e && x.where_ === 'dates') answered.add(`${e.heading}\u0001dates`);
    if (e && x.where_ === 'heading') { answered.add(`${e.heading}\u0001title`); answered.add(`${e.heading}\u0001employer`); }
  }

  // The findings on a heading, from the record as it is now; one that cannot be placed stays whole.
  if (rows.length) for (const f of checkEntries(resume, rec.roles, projectNames())) {
    if (answered.has(`${f.entry}\u0001${f.kind}`)) continue;
    const b = f.loose ? undefined : rows.find((x) => x.kind === 'role' && x.text === f.entry);
    add(b, b ? note(f.loose ? 'flag' : 'fail', entryWords(f.kind, f.was, f.is, !!f.project)) : note(f.loose ? 'flag' : 'fail', f.text));
  }

  // The stored flags, each on the line it concerns. Anchors of one flag on bullets of the same words go on successive
  // lines of those words; several anchors on one heading or the summary all stand there (each result left out of a job).
  // The links' findings and the headings' findings are taken above, from the record as it is now.
  const FRESH = ['link-number', 'link-unknown', 'link-elsewhere', 'unlinked', 'facts', 'project-heading'];
  for (const f of list<Flag>(a.flags)) {
    if (!f || typeof f.text !== 'string' || FRESH.includes(f.kind)) continue;
    const kind: Note['kind'] = f.severity === 'high' ? 'fail' : 'flag';
    const anchors = list<NonNullable<Flag['at']>[number]>(f.at).filter((x) => x && typeof x === 'object' && x.where !== 'resume');
    if (anchors.length === 0) { add(undefined, note(kind, f.text)); continue; }
    const taken = new Set<Built>();
    for (const at of anchors) {
      const fits = (x: Built) => x.place?.where === at.where && x.place.entry === (at.entry ?? '') && x.place.text === (at.text ?? '');
      const b = at.where === 'summary' ? summaryRow : at.where === 'bullet' ? rows.find((x) => !taken.has(x) && fits(x)) ?? rows.find(fits) : rows.find(fits);
      if (b && at.where === 'bullet') taken.add(b);
      add(b, note(kind, b ? flagWords(f, at) : f.text));
    }
  }

  // The council's readers' weak lines, only while the stored resume is the text they were read in; on the one line
  // their words stand in, else for the whole resume with the words they quoted.
  const review = a.review;
  if (review && typeof review === 'object' && review.problemsSig && review.problemsSig === sigOf(resume)) {
    for (const p of list<{ seat?: unknown; quote?: unknown; why?: unknown }>(review.problems)) {
      const seat = String(p?.seat ?? '').trim() || 'A reader', quote = plain(String(p?.quote ?? '')).replace(/^[-•]\s*/, ''), why = String(p?.why ?? '').trim();
      if (quote === '' || why === '') continue;
      const hits = quote.length < 4 ? [] : rows.filter((x) => x.kind !== 'section' && x.kind !== 'name' && x.text.includes(quote));
      add(hits.length === 1 ? hits[0] : undefined, note('flag', hits.length === 1 ? `${seat}: ${why}` : `${seat}, on “${short(quote)}”: ${why}`));
    }
  }

  // The suggestions on a resume the owner edited, on the line each is about: its words struck and added, and while it
  // is open its reason as a note. A decided one is sent too, so the screen can offer Undo right after the choice.
  const words = (line: string) => plain(line.replace(/^#+\s+/, ''));
  for (const x of sugsNow) {
    const b = rowOfLine.get(lines.indexOf(x.status === 'kept' ? x.new : x.old));
    if (!b || x.status === 'stale') continue;
    (b.sugs ??= []).push({ id: String(x.id), status: x.status, word: WORD[x.kind], parts: wordDiff(words(x.old), words(x.new)).map((q, i, all) => ({ id: String(i), ...q, gap: q.kind === 'new' && all[i - 1]?.kind === 'gone' })) });
    if (x.status === 'open') add(b, note('suggestion', x.why));
  }

  // The questions still open about the record: one about a fact on each line that uses it; one about a role on the
  // heading that is about that role. One about anything else is answered where it is asked.
  if (rows.length) {
    const home = homeKeys(Date.now());
    for (const q of openRaised()) {
      const about = q.about.split(',').map((x) => x.trim());
      const factIds = about.map((x) => /^fact:(\d+)$/.exec(x)).filter((m) => m !== null).map((m) => Number(m![1]));
      const roleIds = about.map((x) => /^role:(\d+)$/.exec(x)).filter((m) => m !== null).map((m) => Number(m![1]));
      const go = questionAction(q, home, rec);
      for (const b of rows) {
        const onFact = b.refs.some((x) => x.kind === 'fact' && factIds.includes(Number(x.fact)));
        const onRole = b.kind === 'role' && (b.roleIds ?? []).some((id) => roleIds.includes(id));
        if (onFact || onRole) add(b, note('question', q.text, go.route, go.action));
      }
    }
  }

  // Each line's notes in their order, numbered.
  const finish = (n: Omit<Note, 'id'> & { id?: string }, id: string): Note => ({ ...n, id });
  for (const b of rows) b.notes = b.notes.sort((x, y) => RANK[x.kind] - RANK[y.kind]).map((n, i) => finish(n, `${b.id}-${i}`));
  const wholeNotes = whole.sort((x, y) => RANK[x.kind] - RANK[y.kind]).map((n, i) => finish(n, `whole-${i}`));

  // The facts the lines use, whole, so opening one asks nothing more.
  const cards: FactCard[] = [...used].sort((x, y) => x - y).map((id) => {
    const f = rec.facts.get(id)!, at = placeOf(f, rec.roles, rec.projects);
    const role = at.role === null ? undefined : rec.roles.find((x) => x.id === at.role), project = at.project === null ? undefined : rec.projects.find((p) => p.id === at.project);
    const pRow = project?.via_role ? rec.roles.find((x) => x.id === project.via_role) : undefined;
    const start = project ? (project.start || pRow?.start || '') : role?.start ?? '', end = project ? (project.end || pRow?.end || '') : role?.end ?? '';
    const place = f.role_id === null ? 'General, in no role' : f.project_id !== null ? factWords(f, rec) : `Day to day, in ${factWords(f, rec)}`;
    return { id: String(id), code: fRef(id), text: f.text, number: f.metric, place, when: rangeText(start, end) };
  });

  // The version head: the current letter and its date, then the last versions, newest first, each with its reason.
  const vs = resume.trim() === '' ? [] : versionsOf(jobId), cur = vs.at(-1), letter = cur?.letter ?? 'A';
  const changes = vs.slice(-5).reverse().map((v) => ({ id: String(v.n), letter: v.letter, date: v.made_at > 0 ? SHORT.format(v.made_at) : '', text: v.reason }));
  const balance = balanceOf(job, rec);
  return { ref: nb(jobRef(job.id)), version: nb(`V-${pad(job.id, 3)}-${letter}`), letter, date: cur ? day(cur.made_at) : '', changes,
    title: job.title, company: job.company, pdf: resume ? `/jobs/${job.id}/resume.pdf` : '', edited: job.edited === 1, linked: links !== null, legacy: links === null && resume.trim() !== '' ? LEGACY_LINE : '',
    balance, whole: wholeNotes, rows: rows.map(({ place: _p, roleIds: _r, ...x }) => ({ ...x, sugs: x.sugs ?? [] })), facts: cards };
}
