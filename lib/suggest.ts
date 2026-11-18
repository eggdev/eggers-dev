// Rule 7, stages 3a and 3b: suggestions on a resume the owner edited, with no model. The studio never changes an edited
// text by itself (DESIGN.md rule 7), and no model writes words for it. Three kinds of line have words code can give
// exactly, from the owner's own list, record and words:
// - the Skills line: the skills the owner marked "not confident" on the skills list are taken out of the line as it
//   stands. Nothing is added, moved or reworded; a skill the list does not have stays (the skills flag speaks of it);
// - a heading's title or employer, and the date range of a dates line, from the record (lib/entries.ts, lineFixes, the
//   one-line repairs of repairEntries). The rest of a dates line (a place, a label) stays as the owner wrote it;
// - a bullet's opening (lib/wording.ts): the first word in the tense the job needs, or a duty opener such as
//   "Responsible for building" as the owner's own verb ("Built"). The rest of the bullet stays byte for byte.
// Each is the whole line before and after, a reason in words, and the owner's Keep or Reject.
//
// When one is made (an unchanged state writes nothing, and nothing is made at a start):
// - after the owner's Save (lib/jobs.ts, saveOwnerEdit): the headings, dates lines and bullets;
// - after the skills list changes, in the pass that writes the Skills lines of resumes a model wrote (refreshDueSkills);
// - after a role's title, employer or dates change (server.ts, follow): the headings and dates lines of that employer,
//   and the bullets of every edited resume (a job that ended changes the tense its bullets need).
//   follow() also runs on two reads, GET /questions and GET /queue (Home), so a role change made in another way can
//   make its suggestions there; a read of the resume screen or the job page makes none.
// Only on a resume the owner edited, not sent, and not being read or written. Before one is stored it must pass every
// guard; a failure drops it and never repairs it.
//
// Keep and Undo are the only ways a suggestion changes the text, each one version letter through setResume. Reject
// only records the choice. A suggestion is made once per job and pair of lines, so one rejected is never made again.
import { db, type RoleRow } from './db.ts';
import { checkEntries, lineFixes, normCompany, type LineFix } from './entries.ts';
import { codeFlags, flagContext, projectNames } from './checks.ts';
import { linkFinder, parseLinks, places, type Links } from './links.ts';
import { bulletsOf, opensAsDuty, wrongTense } from './ats.ts';
import { parseResume } from './resume.ts';
import { reviewed } from './skills.ts';
import { setResume } from './versions.ts';
import { dutyOpening, opensWithOpener, tenseOpening } from './wording.ts';
import type { JobRow } from './jobs.ts';

// tense and verb: a bullet's new opening (lib/wording.ts).
export type Kind = 'skills' | 'title' | 'employer' | 'heading' | 'dates' | 'verb' | 'tense';
export type Candidate = { where_: 'skills' | 'heading' | 'dates' | 'bullet'; entry: string; kind: Kind; old: string; new: string; why: string };
export type Suggestion = Candidate & { id: number; job_id: number; source: string; status: 'open' | 'kept' | 'rejected' | 'stale'; edit_at: number; made_at: number; decided_at: number };
type Job = Pick<JobRow, 'id' | 'resume' | 'posting' | 'pages' | 'outcome'> & { edited?: number; links?: string; resume_status?: string; status?: string };

// The words a version's reason and the screen use for what a suggestion changes.
export const WORD: Record<Kind, string> = { skills: 'Skills line', title: 'title', employer: 'employer', heading: 'title and employer', dates: 'dates', verb: 'opening', tense: 'tense' };
const roles = () => db.query('SELECT * FROM roles').all() as RoleRow[];
const standsOnce = (text: string, line: string) => text.split('\n').filter((l) => l === line).length === 1;
const swap = (text: string, from: string, to: string) => text.split('\n').map((l) => (l === from ? to : l)).join('\n');

// Being read or written now, as PATCH /jobs/:id counts it: a change to the resume then waits.
const busy = (j: Job) => j.status === 'queued' || j.status === 'running' || j.resume_status === 'queued' || j.resume_status === 'running';
// A resume a suggestion may be made on: the owner's own edit, not sent, with a text, and not being read or written now.
const open = (j: Job | null): j is Job => !!j && j.edited === 1 && j.outcome === '' && j.resume.trim() !== '' && !busy(j);
const jobOf = (id: number) => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as (Job & JobRow) | null;

// ---------- What the studio would write ----------

// The Skills line: the skills the owner marked "not confident" taken out of each line under a Skills heading, as it
// stands. A skill is recognised as the skills list and its flag recognise one: an item of the line (split at commas,
// semicolons, middle dots and bars, after a label such as "Languages:"), in any case. A skill inside another's name is
// not one ("Java" is not in "JavaScript"). Only after the first review; never a line that would be left empty; never a
// heading line.
const SKILLS_HEAD = /^#{1,6}\s+(?:(?:technical|core)\s+)?(?:skills|technologies)\s*$/i;
// The skills list as the Skills suggestion reads it: every skill's key and name, and the keys marked not confident.
type List = { names: Map<string, string>; unsure: Set<string> };
const listNow = (): List => {
  const all = db.query('SELECT key, name, mark FROM skills').all() as { key: string; name: string; mark: string }[];
  return { names: new Map(all.map((x) => [x.key, x.name])), unsure: new Set(all.filter((x) => x.mark === 'not-confident').map((x) => x.key)) };
};
const keyOf = (item: string) => item.replace(/\*\*|__|`/g, '').replace(/\.$/, '').trim().toLowerCase();
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// The line with the not-confident skills taken out, keeping its prefix, its separators and a closing full stop. Only a
// plain list: an item that opens with "and" or "or", or one of several words the list does not have as one skill
// ("Experienced in Go"), makes the line a sentence, and a sentence gets no suggestion. Each skill is named once, as the
// list spells it.
function withoutUnsure(line: string, list: List): { text: string; gone: string[] } | undefined {
  const unsure = list.unsure;
  const m = /^(\s*(?:[-*•]\s+)?(?:[A-Za-z][A-Za-z &/]{1,28}:\s+)?)(.*)$/.exec(line)!;
  const parts = m[2].split(/(\s*[,;·|•]\s*)/), items = parts.filter((_, i) => i % 2 === 0).map((item, i) => ({ item, sep: parts[i * 2 + 1] ?? '' }));
  const gone = items.filter((x) => unsure.has(keyOf(x.item)));
  if (gone.length === 0) return undefined;
  if (items.some((x) => /^(?:and|or)\b/i.test(keyOf(x.item)) || (/\s/.test(keyOf(x.item)) && !list.names.has(keyOf(x.item))))) return undefined;
  const kept = items.filter((x) => !gone.includes(x));
  if (kept.length === 0 || kept.every((x) => x.item.trim() === '')) return undefined;
  let body = kept.map((x, i) => `${x.item}${i < kept.length - 1 ? x.sep : ''}`).join('');
  if (/\.\s*$/.test(items[items.length - 1].item) && !/\.\s*$/.test(body)) body += '.';
  return { text: `${m[1]}${body}`, gone: [...new Set(gone.map((x) => keyOf(x.item)))].map((k) => list.names.get(k) ?? k) };
}
const skillLines = (text: string) => {
  const lines = text.split('\n'), out: string[] = [];
  let inSkills = false;
  for (const l of lines) {
    if (/^\s*#/.test(l)) { inSkills = SKILLS_HEAD.test(l.trim()); continue; }
    if (inSkills && l.trim() !== '') out.push(l);
  }
  return out;
};
function skillsFixes(j: Job, list = listNow()): Candidate[] {
  if (!reviewed() || list.unsure.size === 0) return [];
  return skillLines(j.resume).flatMap((l) => {
    const w = withoutUnsure(l, list);
    return w ? [{ where_: 'skills' as const, entry: '', kind: 'skills' as const, old: l, new: w.text, why: `You marked ${andList(w.gone)} as not confident.` }] : [];
  });
}
function why(f: LineFix): string {
  if (f.kind === 'dates') return `Your record gives the dates as ${f.is.dates}.`;
  if (f.kind === 'heading') return `Your record gives the title as “${f.is.title}” and the employer as “${f.is.employer}”.`;
  return f.kind === 'title' ? `Your record gives the title as “${f.is.title}”.` : `Your record gives the employer as “${f.is.employer}”.`;
}
const entryFixes = (text: string, rs = roles()) => lineFixes(text, rs, projectNames());
const asCandidate = (f: LineFix): Candidate => ({ where_: f.kind === 'dates' ? 'dates' : 'heading', entry: f.entry, kind: f.kind, old: f.old, new: f.new, why: why(f) });

// A bullet's line: its mark, then exactly the words the skim reads.
const BULLET = /^(\s*[-*•]\s+)(.*)$/;
// The bullets' new openings (lib/wording.ts), each on a line that stands once: a duty opener with the owner's own -ing
// verb, else the first word of a bullet the skim flags for the wrong tense.
function opening(text: string, current: boolean, slips: { text: string; current: boolean }[]) {
  return dutyOpening(text, current) ?? (slips.some((x) => x.text === text && x.current === current) ? tenseOpening(text, current) : undefined);
}
function bulletFixes(j: Job): Candidate[] {
  const lines = j.resume.split('\n'), slips = wrongTense(j.resume);
  return bulletsOf(j.resume).flatMap((b) => {
    const at = lines.filter((l) => BULLET.exec(l)?.[2] === b.text), o = opening(b.text, b.current, slips);
    if (!o || at.length !== 1) return [];
    return [{ where_: 'bullet' as const, entry: '', kind: o.kind, old: at[0], new: `${BULLET.exec(at[0])![1]}${o.to}${o.rest}`, why: o.why }];
  });
}

// The suggestions the record, the list and the owner's words give for this text now, before the guards. `entries`: true
// for every entry, or the ids of the roles whose employers' entries to take.
function raw(j: Job, from: { skills?: boolean; entries?: boolean | Set<number>; bullets?: boolean }, rs = roles()): Candidate[] {
  const out: Candidate[] = [];
  if (from.skills) out.push(...skillsFixes(j));
  if (from.entries) for (const f of entryFixes(j.resume, rs)) if (from.entries === true || f.roles.some((id) => (from.entries as Set<number>).has(id))) out.push(asCandidate(f));
  if (from.bullets) out.push(...bulletFixes(j));
  return out;
}

// ---------- The guards ----------

// The links of a text whose entry key changed (a heading's employer): its lines move to the new key, unchanged.
function rekey(links: Links | null, from: string, to: string): Links | null {
  if (!links || from === to) return links;
  return { ...links, lines: links.lines.map((l) => (l.where === 'bullet' && l.entry === from ? { ...l, entry: to } : l)) };
}
// The link of a bullet whose words change (a new opening kept or undone): the same facts, under the new words.
function moveLink(links: Links | null, text: string, line: number, from: string, to: string): Links | null {
  if (!links) return links;
  const r = parseResume(text, roles().map((x) => x.company)), e = [...r.experience, ...r.projects, ...r.elsewhere].find((x) => x.at.lines.includes(line));
  const entry = e ? normCompany(e.company || e.title) : '', words = (l: string) => l.replace(/^\s*[-*•]\s+/, '');
  let moved = false;
  return { ...links, lines: links.lines.map((l) => (!moved && l.where === 'bullet' && l.entry === entry && l.text === words(from) ? ((moved = true), { ...l, text: words(to) }) : l)) };
}
// The entry key of the heading on a line, as the links name it.
function keyAt(text: string, line: number): string {
  const r = parseResume(text, roles().map((x) => x.company));
  const e = [...r.experience, ...r.projects, ...r.elsewhere].find((x) => x.at.heading === line);
  return e ? normCompany(e.company || e.title) : '';
}
// How much each kind of flag says: each line or item it names counts (a tense flag for two bullets is two). The results
// left out of the record count once: that list grows only because the record now applies to an entry it did not see
// before (a result of an employer the heading now names right), which is no new fault of the text.
const kinds = (fs: { kind: string; at?: unknown[]; items?: unknown[] }[]) => fs.reduce((m, f) => m.set(f.kind, (m.get(f.kind) ?? 0) + (f.kind === 'metrics-dropped' ? 1 : f.at?.length || f.items?.length || 1)), new Map<string, number>());

// Whether the text after a swap raises a flag, or a flag item, that the text before did not.
function newFlags(j: Pick<Job, 'resume' | 'pages'>, after: string, links: Links | null, moved: Links | null): boolean {
  const ctx = flagContext(), now = Date.now();
  const was = kinds(codeFlags(j.resume, j.pages, now, ctx, links, true)), then = kinds(codeFlags(after, j.pages, now, ctx, moved, true));
  return [...then].some(([k, n]) => n > (was.get(k) ?? 0));
}

// Why a suggestion may not be stored ('' when it may): its old line is not exactly one line of the text, standing once
// ("old"); the text with the line swapped raises a flag that was not there ("flags"); the rule that asked for it still
// fires after the swap ("rule"); or a heading's or dates line's new words are not exactly the record's ("record").
// A bullet's new opening also fails when its new line is not exactly the opening code gives for the old one, with the
// rest of the line byte-equal ("record"), or when the line's facts do not move to the new words unchanged ("links").
export function guard(j: Job, c: Candidate, rs = roles()): string {
  if (!standsOnce(j.resume, c.old) || c.new.includes('\n') || c.new === c.old) return 'old';
  if (c.where_ === 'bullet') return bulletGuard(j, c);
  if (c.where_ === 'skills' && (/^\s*#/.test(c.old) || /^\s*#/.test(c.new) || !skillLines(j.resume).includes(c.old))) return 'old';
  const line = j.resume.split('\n').indexOf(c.old), after = swap(j.resume, c.old, c.new);
  const links = parseLinks(j.links ?? ''), moved = c.where_ === 'heading' ? rekey(links, keyAt(j.resume, line), keyAt(after, line)) : links;
  if (newFlags(j, after, links, moved)) return 'flags';
  if (c.where_ === 'skills') {
    // No skill marked not confident is left on the line, and the new words are the line with exactly those taken out.
    const list = listNow();
    if (c.new.split(/\s*[,;·|•]\s*/).some((x) => list.unsure.has(keyOf(x.replace(/^\s*(?:[-*•]\s+)?(?:[A-Za-z][A-Za-z &/]{1,28}:\s+)?/, ''))))) return 'rule';
    return skillsFixes(j, list).some((x) => x.old === c.old && x.new === c.new) ? '' : 'record';
  }
  // The entry of that line, after the swap: no finding of the kind that asked, and its fixes now are none on that line.
  const r = parseResume(after, rs.map((x) => x.company));
  const head = [...r.experience, ...r.projects, ...r.elsewhere].find((e) => (c.where_ === 'heading' ? e.at.heading : e.at.dates) === line)?.heading;
  if (head === undefined) return 'rule';
  const asked = c.where_ === 'dates' ? ['dates'] : ['title', 'employer'];
  if (checkEntries(after, rs, projectNames()).some((f) => f.entry === head && asked.includes(f.kind))) return 'rule';
  // The record's words for that line, read again from the text after the swap.
  const before = entryFixes(j.resume, rs).find((f) => f.line === line);
  return before && before.new === c.new ? '' : 'record';
}

function bulletGuard(j: Job, c: Candidate): string {
  const was = BULLET.exec(c.old), is = BULLET.exec(c.new), b = was ? bulletsOf(j.resume).find((x) => x.text === was[2]) : undefined;
  if (!was || !is || !b || was[1] !== is[1]) return 'old';
  const o = opening(b.text, b.current, wrongTense(j.resume));
  if (!o || o.kind !== c.kind || is[2] !== `${o.to}${o.rest}` || was[2].slice(o.from.length) !== is[2].slice(o.to.length)) return 'record';
  const line = j.resume.split('\n').indexOf(c.old), after = swap(j.resume, c.old, c.new);
  const links = parseLinks(j.links ?? ''), moved = moveLink(links, j.resume, line, c.old, c.new);
  if (links) {
    const companies = roles().map((r) => r.company);
    const factsAt = (text: string, l: Links, words: string) => { const p = places(text, companies).places.find((x) => x.where === 'bullet' && x.text === words); return p ? linkFinder(l)(p)?.facts.join(',') ?? '' : '-'; };
    if (!moved || factsAt(j.resume, links, was[2]) !== factsAt(after, moved, is[2])) return 'links';
  }
  if (newFlags(j, after, links, moved)) return 'flags';
  if (c.kind === 'tense' ? wrongTense(after).some((x) => x.text === is[2]) : opensWithOpener(is[2]) || opensAsDuty(is[2])) return 'rule';
  return '';
}

// The suggestions for this text now that pass every guard.
export function candidates(j: Job, from: { skills?: boolean; entries?: boolean | Set<number>; bullets?: boolean }): Candidate[] {
  const rs = roles();
  return raw(j, from, rs).filter((c) => guard(j, c, rs) === '');
}

// ---------- Making them ----------

// Stores the suggestions of `from` for one job: a new pair is added; a pair made before and gone stale is open again;
// one open, kept or rejected is left as it is. Open suggestions of the same kind of line that the record or the list no
// longer gives go stale. Writes nothing when nothing differs. True when a suggestion was added or opened again.
function make(jobId: number, from: { skills?: boolean; entries?: boolean | Set<number>; bullets?: boolean }, now: number): boolean {
  // Read and written in one immediate transaction: the text the suggestions are made from is the text they are stored for.
  return db.transaction(() => {
    const j = jobOf(jobId);
    if (!open(j)) return false;
    const found = candidates(j, from), stored = db.query('SELECT * FROM resume_suggestions WHERE job_id = ?').all(jobId) as Suggestion[];
    const editAt = (db.query("SELECT coalesce(max(made_at), 0) AS t FROM resume_versions WHERE job_id = ? AND why = 'edited'").get(jobId) as { t: number }).t;
    const add = found.filter((c) => { const s = stored.find((x) => x.old === c.old && x.new === c.new); return !s || s.status === 'stale'; });
    // What the record or the list gives now, without the guards: an open suggestion outside it is no longer true.
    const now_ = raw(j, { skills: from.skills, entries: from.entries ? true : false, bullets: from.bullets });
    const wheres = new Set([...(from.skills ? ['skills'] : []), ...(from.entries ? ['heading', 'dates'] : []), ...(from.bullets ? ['bullet'] : [])]);
    const gone = stored.filter((s) => s.status === 'open' && wheres.has(s.where_) && !now_.some((c) => c.old === s.old && c.new === s.new));
    for (const s of gone) db.query("UPDATE resume_suggestions SET status = 'stale' WHERE id = ? AND status = 'open'").run(s.id);
    for (const c of add) {
      db.query(`INSERT INTO resume_suggestions (job_id, old, new, where_, entry, kind, why, source, status, edit_at, made_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'rule', 'open', ?, ?)
        ON CONFLICT (job_id, old, new) DO UPDATE SET status = 'open', why = excluded.why, kind = excluded.kind, where_ = excluded.where_, entry = excluded.entry, edit_at = excluded.edit_at, made_at = excluded.made_at, decided_at = 0
        WHERE resume_suggestions.status = 'stale'`).run(jobId, c.old, c.new, c.where_, c.entry, c.kind, c.why, editAt, now);
    }
    return add.length > 0;
  }).immediate();
}

const editedJobs = () => (db.query("SELECT id FROM jobs WHERE edited = 1 AND outcome = '' AND resume != ''").all() as { id: number }[]).map((x) => x.id);

// After the owner's Save: the headings, dates lines and bullets of that resume.
export const suggestAfterSave = (jobId: number, now = Date.now()) => make(jobId, { entries: true, bullets: true }, now);
// After the skills list changed: the Skills line of each edited resume. Gives the jobs that gained a suggestion.
export const suggestSkills = (now = Date.now()) => editedJobs().filter((id) => make(id, { skills: true }, now));

// The roles as last seen by this process: a change of a title, employer or dates is found by comparing with them.
let seen: Map<number, { key: string; company: string }> | null = null;
const rolesNow = () => new Map(roles().map((r) => [r.id, { key: [r.title, r.company, r.start, r.end].join('\u0001'), company: normCompany(r.company) }]));
// Takes the roles as they are, so the next change is measured from here (at a start: a read only).
export function seeRoles(): void { seen = rolesNow(); }
// After a change to the record: the headings and dates lines of the employers whose roles changed (a title, employer
// or dates; a role added or deleted), on each edited resume. Writes nothing when no role changed. The copy of the roles
// is taken anew only once every resume was gone through: a pass that fails (the database busy) leaves the change to
// the next one.
export function suggestAfterRoles(now = Date.now()): number[] {
  const was = seen, is = rolesNow();
  if (!was) { seen = is; return []; }
  const changed = new Set<number>(), companies = new Set<string>();
  for (const [id, r] of is) { const w = was.get(id); if (!w || w.key !== r.key) { changed.add(id); companies.add(r.company); if (w) companies.add(w.company); } }
  for (const [id, w] of was) if (!is.has(id)) companies.add(w.company);
  if (changed.size === 0 && companies.size === 0) { seen = is; return []; }
  // Every row of an employer that changed: its entry is the one to read again.
  for (const r of roles()) if (companies.has(normCompany(r.company))) changed.add(r.id);
  const made = editedJobs().filter((id) => make(id, { entries: changed, bullets: true }, now));
  seen = is;
  return made;
}

// ---------- What the screen shows ----------

// The suggestions shown on a resume now: open ones whose line stands once and that the record or the list still gives;
// kept ones whose new line stands once; rejected ones whose line stands once. Nothing is written here.
export function shownSuggestions(j: Job): Suggestion[] {
  if (!open(j)) return [];
  const all = db.query("SELECT * FROM resume_suggestions WHERE job_id = ? AND status IN ('open', 'kept', 'rejected') ORDER BY id").all(j.id) as Suggestion[];
  if (all.length === 0) return [];
  const live = all.some((s) => s.status === 'open') ? raw(j, { skills: all.some((s) => s.where_ === 'skills'), entries: true, bullets: true }) : [];
  return all.filter((s) => (s.status === 'kept' ? standsOnce(j.resume, s.new) : standsOnce(j.resume, s.old)) && (s.status !== 'open' || live.some((c) => c.old === s.old && c.new === s.new)));
}
export const openCount = (j: Job) => shownSuggestions(j).filter((s) => s.status === 'open').length;

// The words of a line as two texts' difference, word by word: what stays, what goes and what comes. Commas,
// semicolons and middle dots are words of their own, so "Go, Python, Kafka" to "Go, Python" strikes ", Kafka" only.
// The most words are kept the same before any space or mark is: "Go, Python, Kubernetes" to "Go, Kubernetes, Terraform"
// strikes "Python, " and keeps Kubernetes.
export type Part = { kind: 'same' | 'gone' | 'new'; text: string };
export function wordDiff(a: string, b: string): Part[] {
  const split = (s: string) => s.match(/[^\s,;·]+|\s+|[,;·]/g) ?? [];
  const x = split(a).slice(0, 400), y = split(b).slice(0, 400);
  const weight = (t: string) => (/^[\s,;·]+$/.test(t) ? 1 : 1000);
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let k = y.length - 1; k >= 0; k--) dp[i][k] = x[i] === y[k] ? dp[i + 1][k + 1] + weight(x[i]) : Math.max(dp[i + 1][k], dp[i][k + 1]);
  const out: Part[] = [], push = (kind: Part['kind'], text: string) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ kind, text }); };
  let i = 0, k = 0, gone = '', added = '';
  const flush = () => { if (gone) push('gone', gone); if (added) push('new', added); gone = ''; added = ''; };
  while (i < x.length || k < y.length) {
    if (i < x.length && k < y.length && x[i] === y[k]) { flush(); push('same', x[i]); i++; k++; }
    else if (k >= y.length || (i < x.length && dp[i + 1][k] >= dp[i][k + 1])) gone += x[i++];
    else added += y[k++];
  }
  flush();
  return out;
}

// ---------- The owner's choice ----------

export type Decided = { ok: true; jobId: number; wrote: boolean } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Decided => ({ ok: false, status, error });
export const GONE = 'That suggestion is gone.';
export const DECIDED = 'This suggestion was already decided.';
export const STALE = 'This line changed since the suggestion was made. Your words stay as they are.';
export const NOTHING = 'There is nothing to undo.';
export const UNDO_STALE = 'This line changed since. Nothing was undone.';
export const BUSY = 'This job’s resume is being written now. Wait for it to finish, then decide.';
export const SENT = 'This resume was sent, and is kept as it was sent. Nothing was changed.';

// Keep, Reject or Undo, in one immediate transaction. Keep swaps the line through setResume, guarded by the text as it
// stands (and the resume still being the owner's edit): the other lines keep their links (a heading's new employer takes
// its lines' links with it), a new letter, and no PDF older than the text. Reject records the choice only. Undo puts
// back what Keep changed, or opens a rejected one again. The caller prints the PDF after a write (`wrote`).
export function decide(id: number, act: 'keep' | 'reject' | 'undo', now = Date.now()): Decided {
  return db.transaction((): Decided => {
    const s = db.query('SELECT * FROM resume_suggestions WHERE id = ?').get(id) as Suggestion | null;
    if (!s) return refuse(404, GONE);
    const j = jobOf(s.job_id);
    if (!j) return refuse(404, GONE);
    // A sent resume is kept as it went out; the suggestion is left as it is (a sent job shows none).
    if (j.outcome !== '') return refuse(409, SENT);
    if (busy(j)) return refuse(409, BUSY);
    const set = (status: Suggestion['status'], at: number) => db.query('UPDATE resume_suggestions SET status = ?, decided_at = ? WHERE id = ?').run(status, at, id);
    const write = (from: string, to: string, why: 'suggestion' | 'undo', reason: string) => {
      const line = j.resume.split('\n').indexOf(from), text = swap(j.resume, from, to);
      const links = s.where_ === 'heading' ? rekey(parseLinks(j.links ?? ''), keyAt(j.resume, line), keyAt(text, line))
        : s.where_ === 'bullet' ? moveLink(parseLinks(j.links ?? ''), j.resume, line, from, to) : 'same';
      return setResume(j.id, text, links === 'same' ? 'same' : links, why, reason, { guard: { resume: j.resume, edited: 1 }, set: { pdf: '', updated_at: now } });
    };
    if (act === 'undo') {
      if (s.status === 'rejected') { if (!open(j) || !standsOnce(j.resume, s.old)) return refuse(409, UNDO_STALE); set('open', 0); return { ok: true, jobId: j.id, wrote: false }; }
      if (s.status !== 'kept') return refuse(409, NOTHING);
      if (!open(j) || !standsOnce(j.resume, s.new) || !write(s.new, s.old, 'undo', `You undid the suggested ${WORD[s.kind]}.`)) return refuse(409, UNDO_STALE);
      set('open', 0);
      return { ok: true, jobId: j.id, wrote: true };
    }
    if (s.status !== 'open' && s.status !== 'stale') return refuse(409, DECIDED);
    if (s.status === 'stale' || !shownSuggestions(j).some((x) => x.id === id)) {
      if (s.status === 'open') set('stale', 0);
      return refuse(409, STALE);
    }
    if (act === 'reject') { set('rejected', now); return { ok: true, jobId: j.id, wrote: false }; }
    // The guards once more, on the text as it is now: another line may have changed since the suggestion was made.
    if (guard(j, s) !== '') { set('stale', 0); return refuse(409, STALE); }
    if (!write(s.old, s.new, 'suggestion', `You kept the suggested ${WORD[s.kind]}.`)) return refuse(409, STALE);
    set('kept', now);
    return { ok: true, jobId: j.id, wrote: true };
  }).immediate();
}
