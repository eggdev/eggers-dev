// The record's writes and reads for the Experience screen (server.ts's /tree, /roles, /projects and /facts routes):
// adding, editing, moving and deleting roles, projects and facts by hand, and the tree as the screen reads it.
// The tree's shape and its rules are lib/tree.ts. Every write here is the owner's own, so a fact it touches is
// confirmed (a later reading of its source leaves it alone), and every refusal is said in words, before anything
// is changed.
import { db, deleteFact, KINDS, nextId } from './db.ts';
import { employmentFields, employmentOf, factRef, marksOf, levelOf, placeOf, projectRef, roleRef, tree, type Employment, type FactLean, type ProjectRow, type TreeRoleRow } from './tree.ts';
import { syncProjects } from './projects.ts';
import { howYouWork, shownLines, verdicts, type DerivedInput } from './derived.ts';
import { inventory } from './metrics.ts';
import { suggestedResults } from './propose.ts';
import { handWrote, openRaised } from './raised.ts';
import { allSkills } from './skills.ts';

type Body = Record<string, unknown>;
// wrote: false when the request changed nothing (a Save with no change), so no time of a hand write is kept for it.
// split: a role line that says "at" more than once: the form then asks for the title and the employer apart.
export type Done = { ok: true; kind: 'role' | 'project' | 'fact'; id: number; ref: string; madeRole?: number; wrote: boolean } | { ok: false; error: string; status: number; split?: boolean };
const refuse = (error: string, status = 400): Done => ({ ok: false, error, status });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const given = (b: Body, k: string) => b[k] !== undefined;
// A text field counts as sent only when it is text: null, a number or an object leaves the stored value as it is.
const sent = (b: Body, k: string) => typeof b[k] === 'string';
const done = (kind: 'role' | 'project' | 'fact', id: number, ref: string, wrote: boolean, now: number, madeRole?: number): Done => {
  if (wrote) handWrote(now);
  return { ok: true, kind, id, ref, wrote, ...(madeRole ? { madeRole } : {}) };
};
// When the owner last wrote to the record by hand: the worker holds its rewrite of unsent resumes for a while after
// it (lib/raised.ts, holdSince), so one sitting of edits causes one rewrite.
export { handWrote };
// A title, an employer or a project's name: one line of at most 200 characters. The owner's text is never cut.
export const MAX_NAME = 200;
// One line: no control or format character (a tab, a zero-width space) and no line or paragraph separator.
const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const nameRefused = (v: string, what: string): Done | null => (NOT_ONE_LINE.test(v) || v.length > MAX_NAME ? refuse(`Keep the ${what} to one line of at most ${MAX_NAME} characters.`) : null);

export const FIRST_LINE = 'Write the first line. Everything else can wait.';
export const ROLE_LINE = 'Write the role as title at employer, such as Director of Engineering at Harborlight Systems.';
export const NEW_ROLE = 'Name the new role as title at employer, or pick one from the list.';
export const WHEN = 'Write the dates like Mar 2023 – now, or 2019–2021.';
export const TWO_AT = 'This says “at” more than once, so the studio cannot tell the title from the employer. Write them in their own fields.';
export const NEW_ROLE_TWO_AT = 'This says “at” more than once, so the studio cannot tell the title from the employer. Add the role under Roles, where each has its own field, then choose it here.';
const GONE_ROLE = 'That role is no longer in your record.';
const GONE_PROJECT = 'That project is no longer in your record.';
const GONE_FACT = 'That fact is no longer in your record.';

// ---------- Reading what the owner typed ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n: number | string) => String(n).padStart(2, '0');
// One date as the record keeps it: YYYY-MM, or YYYY when only the year is known. null when it cannot be read.
export function parseYM(tok: string): string | null {
  const t = tok.trim().replace(/\.$/, '');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(t)) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad2(m[2])}`;
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(t)) && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad2(m[1])}`;
  if ((m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t))) { const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return i >= 0 ? `${m[2]}-${pad2(i + 1)}` : null; }
  if ((m = /^(\d{4})$/.exec(t))) return m[1];
  return null;
}
const NOW_WORD = /^(now|present|today|current|ongoing)$/i;
// A date range in the owner's words ("Mar 2023 – now", "2019–2021", "since 2020"), as start and end. An empty end is
// the present. One date alone is a role still held, or a project of that one month or year. null when it cannot be read.
export function parseWhen(s: string, kind: 'role' | 'project'): { start: string; end: string } | null {
  let t = s.trim();
  if (t === '') return { start: '', end: '' };
  t = t.replace(/(\d{4})\s*-\s*(?=\d{4}\b|[A-Za-z])/g, '$1 – ');
  let a: string | undefined, b: string | undefined, open = false;
  const since = /^(?:since|from)\s+(.+?)(?:\s+(?:to|until|–|—)\s+(.+))?$/i.exec(t);
  if (since) { a = since[1]; b = since[2]; if (!b) open = true; } else { [a, b] = t.split(/\s*(?:–|—|\s-\s|\bto\b|\buntil\b)\s*/i).filter(Boolean); }
  if (b !== undefined && NOW_WORD.test(b.trim())) { open = true; b = undefined; }
  const start = a === undefined ? null : parseYM(a);
  if (start === null) return null;
  const end = b !== undefined ? parseYM(b) : open || kind === 'role' ? '' : start;
  if (end === null) return null;
  if (end !== '' && end < start.slice(0, end.length)) return null;
  return { start, end };
}
// "Head of Platform at Fernway": the role's title and its employer. null without " at ", since a role needs an employer;
// "two" when it says "at" more than once ("Head of Data at Scale at Acme"): which one splits it is a guess, so it is
// asked, never chosen.
export function parseRoleLine(s: string): { title: string; company: string } | null | 'two' {
  const t = s.trim();
  if ((t.match(/\sat\s/gi) ?? []).length > 1) return 'two';
  const m = /^(.*?)\s+at\s+(.+)$/i.exec(t);
  return m && m[1].trim() !== '' && m[2].trim() !== '' ? { title: m[1].trim(), company: m[2].trim() } : null;
}
const EMPLOYMENT: Employment[] = ['', 'employee', 'contract', 'part-time', 'own'];
const MARK_KEYS = ['company', 'title', 'start', 'end', 'type', 'location'] as const;
const dateOk = (v: string) => v === '' || /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v);

// ---------- Reading the tree ----------

const rolesNow = () => db.query('SELECT * FROM roles').all() as TreeRoleRow[];
const projectsNow = () => db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];

// The tree as the Experience screen reads it (GET /tree): every role, project and fact with its reference, and no
// story or evidence (GET /facts/:id has those). questions and derived are a later stage's, empty here.
export function readTree() {
  // A row the worker or another writer added since is given its project first.
  syncProjects();
  const facts = db.query('SELECT id, role_id, project_id, text, metric, kind FROM facts ORDER BY id').all() as FactLean[];
  const rows = rolesNow(), t0 = tree(rows, projectsNow(), facts);
  // Each role's request for suggested projects, and a kept project's suggested result (lib/propose.ts).
  const asked = new Map(rows.map((r) => [String(r.id), { proposeStatus: (r as { propose_status?: string }).propose_status ?? '', proposeNote: (r as { propose_note?: string }).propose_note ?? '' }]));
  const suggested = suggestedResults();
  const t = { roles: t0.roles.map((r) => ({ ...r, ...(asked.get(r.id) ?? { proposeStatus: '', proposeNote: '' }) })),
    projects: t0.projects.map((p) => { const s = suggested.get(Number(p.id)); return { ...p, suggestedResult: s ? s.text : '', suggestedFact: s ? factRef(s.fact) : '', proposal: s ? String(s.proposal) : '' }; }),
    facts: t0.facts };
  // The record's open questions (lib/gaps.ts), each with where its item is, in Home's order.
  const questions = openRaised().filter((q) => q.kind === 'record').sort((a, b) => Number(a.data.rank ?? 0) - Number(b.data.rank ?? 0))
    .map((q) => ({ key: q.key, text: q.text, route: typeof q.data.route === 'string' ? q.data.route : '/record' }));
  const derived = shownLines(howYouWork(derivedInput(t0)), verdicts());
  return { ...t, questions, derived,
    counts: { roles: t.roles.length, projects: t.projects.filter((p) => p.place === 'role').length, sides: t.projects.filter((p) => p.place === 'side').length,
      unplaced: t.projects.filter((p) => p.place === 'unplaced').length, facts: t.facts.length } };
}

// What "How you work" counts from (lib/derived.ts): the tree, each fact's skills, the metrics inventory, the skills list.
export function derivedInput(t: { roles: { id: string }[]; projects: { id: string; learned: string }[]; facts: { id: string; roleId: string; projectId: string; text: string; metric: string }[] }): DerivedInput {
  const skills = new Map((db.query('SELECT id, skills FROM facts').all() as { id: number; skills: string }[]).map((f) => [String(f.id), f.skills]));
  const metrics = inventory(db.query("SELECT id, role_id, metric FROM facts WHERE metric != ''").all() as { id: number; role_id: number | null; metric: string }[]);
  return { roles: t.roles, projects: t.projects, facts: t.facts.map((f) => ({ ...f, skills: skills.get(f.id) ?? '' })), metrics: metrics.map((m) => ({ fact: String(m.fact), kind: m.kind })),
    skills: allSkills().map((s) => ({ name: s.name, kind: s.kind, mark: s.mark })) };
}

// The lines of "How you work" that hold for the record as it is now, for a verdict to be checked against.
export function derivedNow() {
  const facts = db.query('SELECT id, role_id, project_id, text, metric, kind FROM facts ORDER BY id').all() as FactLean[];
  return howYouWork(derivedInput(tree(rolesNow(), projectsNow(), facts)));
}
// The lines the owner kept, among those Experience shows now: what a resume's or a message's writer may be given to
// choose which facts lead (lib/jobs.ts, brief; lib/outreach.ts). A line that no longer holds, one said not to be true
// and one not yet judged are never given.
export const keptLines = () => shownLines(derivedNow(), verdicts()).filter((l) => l.verdict === 'kept');

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// One fact whole (GET /facts/:id): its story, evidence, skills and provenance too. null when it is gone.
export function fullFact(id: number) {
  const f = db.query('SELECT f.*, s.title AS source FROM facts f LEFT JOIN sources s ON s.id = f.source_id WHERE f.id = ?').get(id) as
    (FactLean & { detail: string; skills: string; evidence: string; source_id: number | null; source: string | null; status: string; created_at: number; baseline: string; team: string; own_part: string }) | null;
  if (!f) return null;
  const at = placeOf(f, rolesNow(), projectsNow());
  return { id: String(f.id), ref: factRef(f.id), roleId: at.role === null ? '' : String(at.role), projectId: at.project === null ? '' : String(at.project), kind: f.kind, text: f.text, detail: f.detail,
    metric: f.metric, skills: f.skills, evidence: f.evidence, source: f.source_id === null ? 'Added by hand' : f.source ?? 'A source since deleted',
    added: f.created_at > 0 ? DAY.format(f.created_at) : '', edited: f.source_id !== null && f.status === 'confirmed', baseline: f.baseline, team: f.team, ownPart: f.own_part };
}

// ---------- Roles ----------

const roleRow = (id: number) => db.query('SELECT * FROM roles WHERE id = ?').get(id) as TreeRoleRow | null;
const isRole = (id: number) => { const rows = rolesNow(), r = rows.find((x) => x.id === id); return r !== undefined && levelOf(r, rows) === 'role'; };

// A new role, from {title, company} or from {line: "title at employer"}, with start, end or when, employment and
// location if given. Each field the owner typed is marked "From memory" unless `official` says otherwise.
export function addRole(b: Body, now = Date.now()): Done {
  let title = str(b.title), company = str(b.company);
  if (given(b, 'line')) {
    if (str(b.line) === '') return refuse(FIRST_LINE);
    const parsed = parseRoleLine(str(b.line));
    if (parsed === 'two') return { ok: false, error: TWO_AT, status: 400, split: true };
    if (!parsed) return refuse(ROLE_LINE);
    ({ title, company } = parsed);
  }
  // A role has a title: a row with an employer and no title would be a repository nobody placed, not a role.
  if (!title) return refuse('Enter the official title.');
  if (!company) return refuse('Enter a company.');
  const long = nameRefused(title, 'title') ?? nameRefused(company, 'employer');
  if (long) return long;
  let start = str(b.start), end = str(b.end);
  if (given(b, 'when')) { const w = parseWhen(str(b.when), 'role'); if (!w) return refuse(WHEN); ({ start, end } = w); }
  if (!dateOk(start) || !dateOk(end) || (end !== '' && start !== '' && end < start.slice(0, end.length))) return refuse(WHEN);
  const employment = str(b.employment) as Employment;
  if (!EMPLOYMENT.includes(employment)) return refuse('Choose one of the listed employment types.');
  const kind = employmentFields(employment, ''), location = str(b.location);
  const typed: Record<string, string> = { company, title, start, end, type: employment, location };
  const marks = Object.fromEntries(MARK_KEYS.filter((k) => typed[k] !== '').map((k) => [k, markOf(b, k) || 'memory']));
  const made = db.query(`INSERT INTO roles (id, company, title, start, end, location, standing, label, official) VALUES (${nextId('roles')}, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(company, title, start, end, location, kind.standing, kind.label, JSON.stringify(marks)) as { id: number };
  return done('role', made.id, roleRef(made.id), true, now);
}
const markOf = (b: Body, k: string) => { const o = b.official as Record<string, unknown> | undefined; const v = o && typeof o === 'object' ? o[k] : undefined; return v === 'hr' || v === 'memory' ? v : ''; };

// A role's fields, each optional: today's (standing, reach and partOf together; end, note, label) and the official
// record (title, company, start, end, employment, location) with its marks in `official`. A value that changes loses
// its mark unless `official` sets one (the trigger in lib/db.ts); `official` may also set or clear a mark alone.
export function patchRole(id: number, b: Body, now = Date.now()): Done {
  const role = roleRow(id);
  if (!role) return refuse(GONE_ROLE, 404);
  // standing and partOf go with reach, as before; reach may also be sent alone, beside the official record.
  const kindSent = sent(b, 'standing') || given(b, 'partOf');
  const other = ['end', 'note', 'label', 'title', 'company', 'start', 'location', 'employment', 'reach'].some((k) => sent(b, k)) || given(b, 'official');
  if ((kindSent || !other) && (!['', 'employer', 'own', 'contract', 'personal'].includes(b.standing as string) || !['', 'live', 'retired', 'never'].includes(b.reach as string))) return refuse('Choose one of the listed kinds.');
  if (sent(b, 'reach') && !['', 'live', 'retired', 'never'].includes(b.reach as string)) return refuse('Choose one of the listed kinds.');
  const parent = typeof b.partOf === 'number' ? b.partOf : str(b.partOf) === '' ? null : Number(b.partOf);
  if (kindSent && parent !== null && (parent === id || !db.query("SELECT id FROM roles WHERE id = ? AND title != ''").get(parent))) return refuse('Choose one of your employers.');
  const title = str(b.title), company = str(b.company), location = str(b.location), note = str(b.note), label = str(b.label);
  let start = sent(b, 'start') ? str(b.start) : role.start, end = sent(b, 'end') ? str(b.end) : role.end;
  if (sent(b, 'start') && !dateOk(start)) { const p = parseYM(start); if (p === null) return refuse('Give the start as a month and a year, like Mar 2023.'); start = p; }
  if (sent(b, 'end') && !dateOk(end)) { const p = NOW_WORD.test(end) ? '' : parseYM(end); if (p === null) return refuse('Give the end date as a year and a month, like 2023-06. Leave it empty for a job you hold now.'); end = p; }
  if (end !== '' && start !== '' && end < start.slice(0, end.length)) return refuse('That end date is before the job’s start date.');
  if (sent(b, 'title') && title === '') return refuse('Enter the official title.');
  if (sent(b, 'company') && company === '') return refuse('Enter the employer.');
  const long = (sent(b, 'title') ? nameRefused(title, 'title') : null) ?? (sent(b, 'company') ? nameRefused(company, 'employer') : null);
  if (long) return long;
  if (sent(b, 'note') && (note.length > 200 || note.includes('\n'))) return refuse('Keep the note to one line of at most 200 characters.');
  if (sent(b, 'label') && !['', 'Contract', 'Part-time'].includes(label)) return refuse('Choose Contract, Part-time or no label.');
  const employment = str(b.employment) as Employment;
  if (sent(b, 'employment') && !EMPLOYMENT.includes(employment)) return refuse('Choose one of the listed employment types.');
  const official = b.official as Record<string, unknown> | undefined;
  if (given(b, 'official') && (typeof official !== 'object' || official === null || Object.entries(official).some(([k, v]) => !(MARK_KEYS as readonly string[]).includes(k) || !['', 'hr', 'memory'].includes(v as string)))) return refuse('Choose where each field comes from.');
  // What would change. A field equal to what is stored is left alone, so a Save with no change writes nothing, and
  // the record's signature (which every unsent resume follows) stays as it was. Employment type is a view of standing
  // and label: it is written only when the type itself is not the one stored, since one type has several stored forms.
  const changes: [string, string | number | null][] = [];
  const want = (col: keyof TreeRoleRow, v: string | number | null) => { if ((role[col] ?? null) !== v) changes.push([col as string, v]); };
  if (kindSent || !other) { want('standing', b.standing as string); want('reach', b.reach as string); want('part_of', parent); }
  if (sent(b, 'title')) want('title', title);
  if (sent(b, 'company')) want('company', company);
  if (sent(b, 'start')) want('start', start);
  if (sent(b, 'end')) want('end', end);
  if (sent(b, 'location')) want('location', location);
  if (sent(b, 'note')) want('note', note);
  if (sent(b, 'label')) want('label', label);
  if (sent(b, 'employment') && employment !== employmentOf(role)) { const k = employmentFields(employment, role.standing); want('standing', k.standing); want('label', k.label); }
  if (sent(b, 'reach') && !kindSent) want('reach', b.reach as string);
  const before = marksOf(role.official);
  // The marks after the values: a changed value loses its mark (the trigger in lib/db.ts) unless `official` sets one.
  const cleared = new Set(changes.map(([c]) => (c === 'standing' || c === 'label' ? 'type' : c)));
  const marks: Record<string, string> = Object.fromEntries(Object.entries(before).filter(([k]) => !cleared.has(k)));
  for (const [k, v] of Object.entries(official ?? {})) { if (v === '') delete marks[k]; else marks[k] = v as string; }
  const marksChange = JSON.stringify(Object.entries(marks).sort()) !== JSON.stringify(Object.entries(before).sort());
  if (changes.length === 0 && !marksChange) return done('role', id, roleRef(id), false, now);
  db.transaction(() => {
    for (const [col, v] of changes) db.query(`UPDATE roles SET "${col}" = ? WHERE id = ?`).run(v, id);
    if (marksChange || (official && changes.length > 0)) db.query('UPDATE roles SET official = ? WHERE id = ?').run(JSON.stringify(marks), id);
  })();
  syncProjects();
  return done('role', id, roleRef(id), true, now);
}

// A role and what is in it: its own projects and its facts go (the facts as deleteFact does, so a later reading does
// not bring them back). A repository's project group filed under it is kept, and is then not placed.
export function deleteRole(id: number, now = Date.now()): Done {
  if (!roleRow(id)) return refuse(GONE_ROLE, 404);
  db.transaction(() => {
    for (const f of db.query('SELECT id FROM facts WHERE role_id = ?').all(id) as { id: number }[]) deleteFact(f.id, now);
    db.query('DELETE FROM projects WHERE role_id = ? AND via_role IS NULL').run(id);
    db.query('DELETE FROM project_proposals WHERE role_id = ?').run(id);
    db.query('UPDATE roles SET part_of = NULL WHERE part_of = ?').run(id);
    db.query('DELETE FROM roles WHERE id = ?').run(id);
  })();
  syncProjects(now);
  return done('role', id, roleRef(id), true, now);
}

// ---------- Projects ----------

const projectRow = (id: number) => db.query('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | null;
const PARTS = ['lives', 'situation', 'did', 'result', 'learned'] as const;
// A project's longer parts: each at most this long, refused in words when longer and never cut (as a title is).
export const MAX_PART = 4000;
const PART_WORDS: Record<string, string> = { situation: 'the situation', did: 'what you did', result: 'the result', learned: 'what you learned' };
const partsRefused = (parts: Partial<Record<string, string>>): Done | null => {
  const long = Object.keys(PART_WORDS).find((k) => (parts[k] ?? '').length > MAX_PART);
  return long ? refuse(`Keep ${PART_WORDS[long]} to at most 4,000 characters. Nothing was saved.`) : null;
};
const partsOf = (b: Body) => { const p = (b.parts && typeof b.parts === 'object' ? b.parts : b) as Body; return Object.fromEntries(PARTS.filter((k) => sent(p, k)).map((k) => [k, str(p[k])])) as Partial<Record<(typeof PARTS)[number], string>>; };

// Where a new project or fact goes: an existing role, a side project, or a role made on the spot from "title at
// employer". Returns the role id (null for a side project) and the role it made, if any.
function roleFor(b: Body, now: number): { role: number | null; made?: number } | Done {
  if (given(b, 'newRole')) {
    const parsed = parseRoleLine(str(b.newRole));
    if (parsed === 'two') return refuse(NEW_ROLE_TWO_AT);
    if (!parsed) return refuse(NEW_ROLE);
    const made = addRole({ title: parsed.title, company: parsed.company }, now);
    if (!made.ok) return made;
    return { role: made.id, made: made.id };
  }
  if (b.side === true) return { role: null };
  const role = Number(b.roleId);
  if (!Number.isInteger(role) || !isRole(role)) return refuse('Choose the role it belongs to.');
  return { role };
}

// Runs a write in one transaction; a refusal from inside it undoes everything it did.
class Refused extends Error { constructor(readonly done: Done) { super('refused'); } }
function runRefusable(write: () => Done): Done {
  try {
    return db.transaction(() => { const d = write(); if (!d.ok) throw new Refused(d); return d; })();
  } catch (e) { if (e instanceof Refused) return e.done; throw e; }
}

// A new project, in a role ({roleId}, or {newRole: "title at employer"}) or on the side ({side: true}). A side
// project is a `roles` row the resume pipeline reads as a personal project, with its project pointing at it.
export function addProject(b: Body, now = Date.now()): Done {
  const title = str(b.title);
  if (title === '') return refuse(FIRST_LINE);
  const long = nameRefused(title, 'name');
  if (long) return long;
  const w = given(b, 'when') ? parseWhen(str(b.when), 'project') : { start: str(b.start), end: str(b.end) };
  if (!w || !dateOk(w.start) || !dateOk(w.end)) return refuse(WHEN);
  const parts = partsOf(b), cols = PARTS.filter((k) => parts[k] !== undefined), vals = cols.map((k) => parts[k]!);
  const tooLong = partsRefused(parts);
  if (tooLong) return tooLong;
  const more = { names: cols.map((c) => `, ${c}`).join(''), marks: cols.map(() => ', ?').join('') };
  return runRefusable(() => {
    const home = roleFor(b, now);
    if ('ok' in home) return home;
    let id: number;
    if (home.role === null) {
      const carrier = db.query(`INSERT INTO roles (id, company, title, start, end, standing) VALUES (${nextId('roles')}, ?, '', ?, ?, 'personal') RETURNING id`).get(title, w.start, w.end) as { id: number };
      id = (db.query(`INSERT INTO projects (via_role, created_at${more.names}) VALUES (?, ?${more.marks}) RETURNING id`).get(carrier.id, now, ...vals) as { id: number }).id;
    } else {
      id = (db.query(`INSERT INTO projects (role_id, title, start, end, created_at${more.names}) VALUES (?, ?, ?, ?, ?${more.marks}) RETURNING id`).get(home.role, title, w.start, w.end, now, ...vals) as { id: number }).id;
    }
    return done('project', id, projectRef(id), true, now, home.made);
  });
}

// A project's name, dates and parts, each optional. A project carried by a `roles` row keeps its name and dates
// there. A project nobody placed (or a side project) is placed by {roleId} or {side: true}: that is its row's
// part_of, or its row made personal. A project of a role stays in its role: its facts move one by one.
export function patchProject(id: number, b: Body, now = Date.now()): Done {
  const p = projectRow(id);
  if (!p) return refuse(GONE_PROJECT, 404);
  const title = str(b.title);
  if (sent(b, 'title') && title === '') return refuse('Enter the project’s name.');
  const long = sent(b, 'title') ? nameRefused(title, 'name') : null;
  if (long) return long;
  const w = sent(b, 'when') ? parseWhen(str(b.when), 'project') : null;
  if (sent(b, 'when') && !w) return refuse(WHEN);
  const placing = given(b, 'roleId') || b.side === true;
  if (placing && p.via_role === null) return refuse('A project of a role stays in its role. Move its facts one by one instead.');
  const role = given(b, 'roleId') ? Number(b.roleId) : null;
  if (role !== null && (!Number.isInteger(role) || !isRole(role))) return refuse('Choose the role it belongs to.');
  // Only what differs from what is stored is written: a Save with no change writes nothing. A carried project's name
  // and dates are its `roles` row's, so writing them there would change the record's signature.
  const tooLong = partsRefused(partsOf(b));
  if (tooLong) return tooLong;
  const parts = Object.entries(partsOf(b)).filter(([k, v]) => p[k as keyof ProjectRow] !== v);
  const carrier = p.via_role === null ? null : roleRow(p.via_role);
  const rowChanges: [string, string | number | null][] = [], ownChanges: [string, string][] = [];
  if (carrier) {
    if (sent(b, 'title') && carrier.company !== title) rowChanges.push(['company', title]);
    if (w && carrier.start !== w.start) rowChanges.push(['start', w.start]);
    if (w && carrier.end !== w.end) rowChanges.push(['end', w.end]);
    if (role !== null && carrier.part_of !== role) rowChanges.push(['part_of', role]);
    else if (b.side === true) { if (carrier.part_of !== null) rowChanges.push(['part_of', null]); if (carrier.standing !== 'personal') rowChanges.push(['standing', 'personal']); }
  } else {
    if (sent(b, 'title') && p.title !== title) ownChanges.push(['title', title]);
    if (w && p.start !== w.start) ownChanges.push(['start', w.start]);
    if (w && p.end !== w.end) ownChanges.push(['end', w.end]);
  }
  if (parts.length + rowChanges.length + ownChanges.length === 0) return done('project', id, projectRef(id), false, now);
  db.transaction(() => {
    for (const [k, v] of [...parts, ...ownChanges]) db.query(`UPDATE projects SET ${k} = ? WHERE id = ?`).run(v as string, id);
    for (const [k, v] of rowChanges) db.query(`UPDATE roles SET "${k}" = ? WHERE id = ?`).run(v, carrier!.id);
  })();
  return done('project', id, projectRef(id), true, now);
}

// A project goes; its facts stay (facts=keep, the default) or go with it (facts=delete). Kept facts of a project in a
// role return to that role's Day to day; those of a side project, or of one nobody placed, to General.
export function deleteProject(id: number, facts: 'keep' | 'delete' = 'keep', now = Date.now()): Done {
  const p = projectRow(id);
  if (!p) return refuse(GONE_PROJECT, 404);
  db.transaction(() => {
    if (p.via_role === null) {
      // Only the facts in this project and of its role: a fact of another role that still names it (moved by an older
      // writer) is in that role's Day to day already, so it only loses the stray name, and is never deleted with it.
      db.query('UPDATE facts SET project_id = NULL WHERE project_id = ? AND role_id IS NOT ?').run(id, p.role_id);
      if (facts === 'delete') for (const f of db.query('SELECT id FROM facts WHERE project_id = ? AND role_id IS ?').all(id, p.role_id) as { id: number }[]) deleteFact(f.id, now);
      else db.query('UPDATE facts SET project_id = NULL WHERE project_id = ?').run(id);
    } else {
      const row = roleRow(p.via_role), rows = rolesNow();
      const parent = row && levelOf(row, rows) === 'project' ? row.part_of : null;
      if (facts === 'delete') for (const f of db.query('SELECT id FROM facts WHERE role_id = ?').all(p.via_role) as { id: number }[]) deleteFact(f.id, now);
      else db.query("UPDATE facts SET role_id = ?, project_id = NULL, status = 'confirmed' WHERE role_id = ?").run(parent, p.via_role);
      db.query('DELETE FROM roles WHERE id = ?').run(p.via_role);
    }
    db.query('DELETE FROM projects WHERE id = ?').run(id);
  })();
  return done('project', id, projectRef(id), true, now);
}

// ---------- Facts ----------

// Where a fact is filed, from {projectId}, {roleId} (its Day to day), {newRole} or neither (General), as the columns
// that hold it. A fact in a project of its role keeps its role_id; one in a carried project takes the project's row.
function homeFor(b: Body, now: number): { role_id: number | null; project_id: number | null; made?: number } | Done {
  if (given(b, 'projectId') && str(String(b.projectId)) !== '') {
    const p = projectRow(Number(b.projectId));
    if (!p) return refuse(GONE_PROJECT, 409);
    if (p.via_role !== null) return { role_id: p.via_role, project_id: null };
    if (p.role_id === null || !isRole(p.role_id)) return refuse(GONE_ROLE, 409);
    return { role_id: p.role_id, project_id: p.id };
  }
  if (given(b, 'newRole')) {
    const home = roleFor(b, now);
    if ('ok' in home) return home;
    return { role_id: home.role, project_id: null, made: home.made };
  }
  const raw = typeof b.roleId === 'number' ? String(b.roleId) : str(b.roleId);
  if (raw === '' || raw === '0') return { role_id: null, project_id: null };
  const role = Number(raw);
  if (!Number.isInteger(role) || !roleRow(role)) return refuse(GONE_ROLE, 409);
  return { role_id: role, project_id: null };
}

// A fact written by hand (or by a test) is the person's own word: confirmed unless it says otherwise.
export function addFact(b: Body, now = Date.now()): Done {
  if (!str(b.text)) return refuse('Enter the fact.');
  const kind = (KINDS as readonly string[]).includes(b.kind as string) ? (b.kind as string) : 'accomplishment';
  return runRefusable(() => {
    const home = homeFor(b, now);
    if ('ok' in home) return home;
    const made = db.query(`INSERT INTO facts (id, role_id, project_id, kind, text, detail, metric, skills, evidence, source_id, status, created_at, baseline, team, own_part)
      VALUES (${nextId('facts')}, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?) RETURNING id`)
      .get(home.role_id, home.project_id, kind, str(b.text), str(b.detail), str(b.metric), str(b.skills), str(b.evidence), b.proposed === true ? 'proposed' : 'confirmed', now,
        str(b.baseline), str(b.team), str(b.ownPart)) as { id: number };
    return done('fact', made.id, factRef(made.id), true, now, home.made);
  });
}

// A fact's own words and where it is filed. Each field is its own: text, detail (the story) and metric change only
// when sent, so a partial edit keeps the rest. Moving it ({projectId}, {roleId}) or editing it confirms it, so a later
// reading of its source keeps it where the owner put it.
export function patchFact(id: number, b: Body, now = Date.now()): Done {
  const f = db.query('SELECT id, role_id, project_id, kind, text, detail, metric, baseline, team, own_part, status FROM facts WHERE id = ?').get(id) as
    { id: number; role_id: number | null; project_id: number | null; kind: string; text: string; detail: string; metric: string; baseline: string; team: string; own_part: string; status: string } | null;
  if (!f) return refuse(GONE_FACT, 404);
  if (sent(b, 'text') && !str(b.text)) return refuse('Enter the fact.');
  return runRefusable(() => {
    // Where it goes: a project ({projectId}), a role made on the spot ({newRole}), a role's Day to day ({roleId} with
    // projectId "", or {projectId: ""} alone for its own role's), or (roleId alone, as older screens send it) another
    // role's Day to day; the same role sent back alone keeps the fact's project. A fact that changes role always
    // leaves its project, which belongs to the old role.
    const project = given(b, 'projectId') ? str(String(b.projectId)) : undefined;
    let home: { role_id: number | null; project_id: number | null } | Done | null = null;
    if (project !== undefined && project !== '') home = homeFor({ projectId: project }, now);
    else if (given(b, 'newRole')) home = homeFor({ newRole: b.newRole }, now);
    else if (given(b, 'roleId') && (project === '' || String(b.roleId) !== String(f.role_id ?? ''))) home = homeFor({ roleId: b.roleId }, now);
    else if (project === '') home = { role_id: f.role_id, project_id: null };
    if (home && 'ok' in home) return home;
    // Only what differs from what is stored is written: a Save with no change writes nothing, and confirms nothing.
    const changes: [string, string | number | null][] = [];
    if (home && (home.role_id !== f.role_id || home.project_id !== f.project_id)) changes.push(['role_id', home.role_id], ['project_id', home.project_id]);
    if (typeof b.kind === 'string' && (KINDS as readonly string[]).includes(b.kind) && b.kind !== f.kind) changes.push(['kind', b.kind]);
    for (const [key, col] of [['text', 'text'], ['detail', 'detail'], ['metric', 'metric'], ['baseline', 'baseline'], ['team', 'team'], ['ownPart', 'own_part']] as const) {
      if (sent(b, key) && str(b[key]) !== f[col]) changes.push([col, str(b[key])]);
    }
    if (changes.length === 0) return done('fact', id, factRef(id), false, now);
    for (const [col, v] of changes) db.query(`UPDATE facts SET ${col} = ? WHERE id = ?`).run(v, id);
    db.query("UPDATE facts SET status = 'confirmed' WHERE id = ?").run(id);
    return done('fact', id, factRef(id), true, now);
  });
}

export function removeFact(id: number, now = Date.now()): Done {
  if (!db.query('SELECT id FROM facts WHERE id = ?').get(id)) return refuse(GONE_FACT, 404);
  deleteFact(id, now);
  return done('fact', id, factRef(id), true, now);
}

