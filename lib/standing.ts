// Where each piece of work stands: when it was last worked and whether it still runs, who may see it, and where it
// comes in the one ordered list of projects. The You screen (lib/you.ts) reads the order and the marks; the writers
// read the record as before. Every change here is additive: two new tables and their triggers, created when this file is imported.
// "Standing" here is not `roles.standing` (employer, own, contract, personal: the kind of work a role was).
//
// - A project's start and end stay in `projects` (or, for a carried project, in the `roles` row it points at). This
//   file adds only what those columns cannot say: the month the work was last done, and its state.
// - A fact may carry its own month. Without one it takes its project's dates, then its role's.
// - A mark says who may use a fact. `kept` never leaves the record, and it fails closed: a fact that is kept, or is in
//   a kept project, is kept, whatever else is marked. `public` is set on a fact only, and only offers it for the draft
//   of the public collection (lib/public.ts): the public assistant reads only the collection the owner saved, never
//   the record, so no live check here lets it read a fact. Anything else is `documents`.
// - The rank is one order over every project. The owner may set a project's place; the tool places the rest.
import { createHash } from 'node:crypto';
import { carryFacts, db, norm, type CarriedFact, type RoleRow, type Skipped } from './db.ts';
import type { Surface } from './rules.ts';
import { factRef, levelOf, placeOf, type ProjectRow } from './tree.ts';

// running: still in use. ended: finished as planned. off: turned off or shut down. unknown: the owner has not said.
export const STATES = ['running', 'ended', 'off', 'unknown'] as const;
export type WorkState = (typeof STATES)[number];
// public: offered for the draft of the public collection, and usable in documents. documents: resumes, the profile and
// messages may use it. kept: it never leaves the record.
export const MARKS = ['public', 'documents', 'kept'] as const;
export type Mark = (typeof MARKS)[number];
// A project may be kept or documents. It is never public: a fact is offered to the public only when the owner marks
// that fact, so a fact added to a project later is never public by being there.
export const PROJECT_MARKS = ['documents', 'kept'] as const;
export type ProjectMark = (typeof PROJECT_MARKS)[number];
// What an unmarked fact counts as.
export const DEFAULT_MARK: Mark = 'documents';
// Who set a fact's mark: the owner, or the tool, which only ever sets kept (to keep a kept fact kept across a change
// to the record; see the triggers and carryFacts below). The owner can see a mark the tool set and change it.
export type MarkedBy = 'owner' | 'tool';

// mark '' is unmarked. place is where the owner put the project (1 is first), or NULL.
db.run(`CREATE TABLE IF NOT EXISTS project_standing (
  project_id INTEGER PRIMARY KEY, last_worked TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('running', 'ended', 'off', 'unknown')),
  mark TEXT NOT NULL DEFAULT '' CHECK (mark IN ('', 'documents', 'kept')),
  place INTEGER CHECK (place IS NULL OR place >= 1), changed_at INTEGER NOT NULL DEFAULT 0)`);
// Why the tool marked a fact kept. left-kept-project: the fact left a kept project (moved, its project deleted with its
// facts kept, or read again outside it). kept-project-deleted: its kept project was deleted around it.
// folded-kept-duplicate: a kept duplicate was folded into it (lib/dedupe.ts). same-words-as-kept: it was written with
// the same words as a kept fact elsewhere. The tool never sets any mark but kept, and never for another reason.
export const TOOL_REASONS = ['left-kept-project', 'kept-project-deleted', 'folded-kept-duplicate', 'same-words-as-kept'] as const;
export type ToolReason = (typeof TOOL_REASONS)[number];

// month is YYYY-MM or ''. mark '' is unmarked. marked_by: owner | tool | '' (unmarked). approved: for a public mark,
// a hash of the fact's text, detail and metric when the owner marked it; '' otherwise. reason, reason_ref and
// reason_name: for a mark the tool set, why, the project or fact it refers to, and that row's name or words (kept here,
// since the row may be gone). changed_at: when the mark or the month last changed, by the owner or the tool.
db.run(`CREATE TABLE IF NOT EXISTS fact_standing (
  fact_id INTEGER PRIMARY KEY, month TEXT NOT NULL DEFAULT '',
  mark TEXT NOT NULL DEFAULT '' CHECK (mark IN ('', 'public', 'documents', 'kept')),
  marked_by TEXT NOT NULL DEFAULT '' CHECK (marked_by IN ('', 'owner', 'tool')), approved TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '' CHECK (reason IN ('', 'left-kept-project', 'kept-project-deleted', 'folded-kept-duplicate', 'same-words-as-kept')),
  reason_ref INTEGER, reason_name TEXT NOT NULL DEFAULT '', changed_at INTEGER NOT NULL DEFAULT 0)`);

// The kept projects a fact with this role_id and project_id is in. Wider than the tree on purpose (it fails closed):
// a fact names a kept project by its project_id, or by its role_id when the project carries that roles row, whatever
// level the row has now. So a side project's row given a title keeps its facts kept.
const keptOf = (role: string, project: string) =>
  `SELECT x.id FROM project_standing s JOIN projects x ON x.id = s.project_id WHERE s.mark = 'kept' AND (x.id = ${project} OR (x.via_role IS NOT NULL AND x.via_role = ${role}))`;
const inKept = (role: string, project: string) => `EXISTS (${keptOf(role, project)})`;
// A project's name: its title, or for a carried project its row's company.
const nameOf = (title: string, viaRole: string) => `coalesce(nullif(${title}, ''), (SELECT company FROM roles WHERE id = ${viaRole}), '')`;
// Now, in milliseconds, as Date.now() gives it.
const NOW_SQL = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
// Writes kept onto facts as the tool's mark, with why. A fact already kept keeps who marked it and why.
const keepSql = (which: string, reason: ToolReason, ref: string, name: string) => `INSERT OR IGNORE INTO fact_standing (fact_id) SELECT id FROM facts WHERE ${which};
  UPDATE fact_standing SET marked_by = 'tool', reason = '${reason}', reason_ref = ${ref}, reason_name = ${name}, changed_at = ${NOW_SQL}, mark = 'kept', approved = ''
    WHERE mark != 'kept' AND fact_id IN (SELECT id FROM facts WHERE ${which});`;
const leftRef = `(${keptOf('OLD.role_id', 'OLD.project_id')} ORDER BY x.id LIMIT 1)`;

// Fact text as a trigger can compare it. SQLite has no norm() (lib/db.ts), so this does the part it can: tabs and line
// breaks become spaces, runs of spaces become one, the ends are trimmed and ASCII letters lower-cased. Every step keeps
// norm()'s result, so two texts with the same key always have the same norm(): a trigger never finds words the same
// that norm() would call different. It can miss two that differ only in non-ASCII case or spacing; the code paths in
// this file (the owner's marks, a reading) compare with norm() itself.
const sqlKey = (x: string) => {
  let e = `replace(replace(replace(${x}, char(9), ' '), char(10), ' '), char(13), ' ')`;
  for (let i = 0; i < 6; i++) e = `replace(${e}, '  ', ' ')`;
  return `lower(trim(${e}))`;
};
// The key of a text, as the triggers work it out: for the test that holds it to norm().
export const triggerKey = (text: string) => (db.query(`SELECT ${sqlKey('?1')} AS k`).get(text) as { k: string }).k;
// Whether fact k is kept in its own right: by a mark that is not itself a same-words copy, or through a kept project.
// A copy is never a root, so a chain of copies always points at a fact kept in its own right.
const isRootSql = (k: string) => `(EXISTS (SELECT 1 FROM fact_standing r WHERE r.fact_id = ${k}.id AND r.mark = 'kept'
  AND NOT (r.marked_by = 'tool' AND r.reason = 'same-words-as-kept')) OR ${inKept(`${k}.role_id`, `${k}.project_id`)})`;

// kept_words: the key (above) of every fact kept in its own right, so a trigger finds a kept fact with the same words by
// one indexed lookup instead of reading every fact. It is never edited by hand: the triggers below keep it equal to
// isRootSql over all facts (a fact's own mark changes, a project's mark changes, a fact moves, its text changes, it
// goes), and it is rebuilt in full at every start.
db.run('CREATE TABLE IF NOT EXISTS kept_words (fact_id INTEGER PRIMARY KEY, key TEXT NOT NULL)');
db.run('CREATE INDEX IF NOT EXISTS kept_words_key ON kept_words (key)');
db.run('CREATE INDEX IF NOT EXISTS fact_standing_ref ON fact_standing (reason_ref)');
const ANY_KEPT = '(SELECT 1 FROM kept_words LIMIT 1) IS NOT NULL';
const ANY_KEPT_PROJECT = "(SELECT 1 FROM project_standing WHERE mark = 'kept' LIMIT 1) IS NOT NULL";
// Works kept_words out again for the facts `which` names (a condition on facts k).
const refreshKept = (which: string) => `DELETE FROM kept_words WHERE fact_id IN (SELECT k.id FROM facts k WHERE ${which});
  INSERT INTO kept_words (fact_id, key) SELECT k.id, ${sqlKey('k.text')} FROM facts k WHERE ${which} AND ${isRootSql('k')};`;
const inProject = (id: string, viaRole: string) => `(k.project_id = ${id} OR (${viaRole} IS NOT NULL AND k.role_id = ${viaRole}))`;
// The first fact kept in its own right, other than `id`, whose key is `key`.
const rootFor = (id: string, key: string) => `(SELECT min(w.fact_id) FROM kept_words w WHERE w.key = ${key} AND w.fact_id != ${id})`;
// Marks fact `id` a same-words copy when its key is a kept fact's. Does nothing while nothing is kept.
const copyOf = (id: string, key: string) => `INSERT OR IGNORE INTO fact_standing (fact_id) SELECT ${id} WHERE ${ANY_KEPT} AND ${rootFor(id, key)} IS NOT NULL;
  UPDATE fact_standing SET marked_by = 'tool', reason = 'same-words-as-kept', reason_ref = ${rootFor(id, key)},
    reason_name = coalesce((SELECT text FROM facts WHERE id = ${rootFor(id, key)}), ''), changed_at = ${NOW_SQL}, mark = 'kept', approved = ''
    WHERE fact_id = ${id} AND mark != 'kept' AND ${ANY_KEPT} AND ${rootFor(id, key)} IS NOT NULL;`;
const IS_COPY = "marked_by = 'tool' AND reason = 'same-words-as-kept'";
const CLEAR_SQL = `mark = '', marked_by = '', reason = '', reason_ref = NULL, reason_name = '', changed_at = ${NOW_SQL}`;
const KEY_NEW = sqlKey('NEW.text');
const copyKey = sqlKey('(SELECT f.text FROM facts f WHERE f.id = fact_standing.fact_id)');

// The triggers are made again at every start, in one transaction under the write lock (as lib/db.ts does with its
// own), so a change to a body here reaches a database that has the older one. No trigger here writes to the table it
// fires on, so none can set itself off again.
db.transaction(() => {
  for (const t of ['fact_standing_gone', 'project_standing_gone', 'fact_standing_fresh', 'project_standing_fresh', 'fact_left_kept', 'project_kept_gone', 'fact_same_words',
    'fact_kept_moved', 'kept_words_mark_added', 'kept_words_mark_changed', 'kept_words_mark_gone', 'kept_words_project_added', 'kept_words_project_changed']) db.run(`DROP TRIGGER IF EXISTS ${t}`);
  // A deletion the owner asks for is real: a deleted fact or project takes its marks, dates and place with it.
  db.run('CREATE TRIGGER fact_standing_gone AFTER DELETE ON facts BEGIN DELETE FROM fact_standing WHERE fact_id = OLD.id; DELETE FROM kept_words WHERE fact_id = OLD.id; END');
  // A deleted project's facts are worked out again once it is gone: they were kept through it, and may no longer be.
  db.run(`CREATE TRIGGER project_standing_gone AFTER DELETE ON projects BEGIN
    DELETE FROM project_standing WHERE project_id = OLD.id;
    ${refreshKept(inProject('OLD.id', 'OLD.via_role'))}
  END`);
  // A new fact never takes a row left behind under its id. It is kept in its own right only if it lands in a kept
  // project; and it is a same-words copy if it says a kept fact's words. One trigger, so these run in this order.
  db.run(`CREATE TRIGGER fact_standing_fresh AFTER INSERT ON facts BEGIN
    DELETE FROM fact_standing WHERE fact_id = NEW.id;
    DELETE FROM kept_words WHERE fact_id = NEW.id;
    INSERT INTO kept_words (fact_id, key) SELECT k.id, ${sqlKey('k.text')} FROM facts k WHERE k.id = NEW.id AND ${ANY_KEPT_PROJECT} AND ${isRootSql('k')};
    ${copyOf('NEW.id', KEY_NEW)}
  END`);
  db.run('CREATE TRIGGER project_standing_fresh AFTER INSERT ON projects BEGIN DELETE FROM project_standing WHERE project_id = NEW.id; END');
  // A fact's text changed, while anything is kept or this fact is a copy (see the four cases in the comment above the
  // tool's marks, below):
  // 1. its own key in kept_words follows its words;
  // 2. its copies that no longer say its words move to another kept fact that says theirs, or are cleared;
  // 3. if it is itself a copy, it moves the same way, stays while it still says the kept words it copied (their fact
  //    may be gone), or is cleared;
  // 4. if it now says a kept fact's words, it is a copy;
  // 5. if it is kept in its own right, every other fact that says its new words is a copy. Only this step reads every
  //    fact, and only when a kept fact itself is reworded.
  db.run(`CREATE TRIGGER fact_same_words AFTER UPDATE OF text ON facts
    WHEN OLD.text IS NOT NEW.text AND (${ANY_KEPT} OR EXISTS (SELECT 1 FROM fact_standing WHERE fact_id = NEW.id AND ${IS_COPY}))
  BEGIN
    ${refreshKept('k.id = NEW.id')}
    UPDATE fact_standing SET reason_ref = (SELECT min(w.fact_id) FROM kept_words w WHERE w.key = ${copyKey} AND w.fact_id != fact_standing.fact_id),
      reason_name = coalesce((SELECT f.text FROM facts f WHERE f.id = (SELECT min(w.fact_id) FROM kept_words w WHERE w.key = ${copyKey} AND w.fact_id != fact_standing.fact_id)), '')
      WHERE ${IS_COPY} AND reason_ref = NEW.id AND ${copyKey} IS NOT ${KEY_NEW};
    UPDATE fact_standing SET
      reason_name = CASE WHEN ${rootFor('NEW.id', KEY_NEW)} IS NOT NULL THEN coalesce((SELECT text FROM facts WHERE id = ${rootFor('NEW.id', KEY_NEW)}), '') ELSE reason_name END,
      reason_ref = coalesce(${rootFor('NEW.id', KEY_NEW)}, CASE WHEN ${sqlKey('reason_name')} = ${KEY_NEW} THEN reason_ref END)
      WHERE fact_id = NEW.id AND ${IS_COPY};
    UPDATE fact_standing SET ${CLEAR_SQL} WHERE ${IS_COPY} AND reason_ref IS NULL;
    ${copyOf('NEW.id', KEY_NEW)}
    ${keepSql(`id != NEW.id AND EXISTS (SELECT 1 FROM kept_words WHERE fact_id = NEW.id) AND ${sqlKey('text')} = ${KEY_NEW}`, 'same-words-as-kept', 'NEW.id', 'NEW.text')}
  END`);
  // A fact that moves into or out of a kept project is kept in its own right, or no longer.
  db.run(`CREATE TRIGGER fact_kept_moved AFTER UPDATE OF role_id, project_id ON facts
    WHEN (OLD.role_id IS NOT NEW.role_id OR OLD.project_id IS NOT NEW.project_id) AND ${ANY_KEPT_PROJECT}
    BEGIN ${refreshKept('k.id = NEW.id')} END`);
  // A fact's own kept mark set, changed or gone.
  db.run(`CREATE TRIGGER kept_words_mark_added AFTER INSERT ON fact_standing WHEN NEW.mark = 'kept' BEGIN ${refreshKept('k.id = NEW.fact_id')} END`);
  db.run(`CREATE TRIGGER kept_words_mark_changed AFTER UPDATE OF mark, marked_by, reason ON fact_standing
    WHEN OLD.mark IS NOT NEW.mark OR OLD.marked_by IS NOT NEW.marked_by OR OLD.reason IS NOT NEW.reason BEGIN ${refreshKept('k.id = NEW.fact_id')} END`);
  db.run(`CREATE TRIGGER kept_words_mark_gone AFTER DELETE ON fact_standing WHEN OLD.mark = 'kept' BEGIN ${refreshKept('k.id = OLD.fact_id')} END`);
  // A project's kept mark set or cleared: its facts are worked out again.
  db.run(`CREATE TRIGGER kept_words_project_added AFTER INSERT ON project_standing WHEN NEW.mark = 'kept'
    BEGIN ${refreshKept(inProject('NEW.project_id', '(SELECT via_role FROM projects WHERE id = NEW.project_id)'))} END`);
  db.run(`CREATE TRIGGER kept_words_project_changed AFTER UPDATE OF mark ON project_standing WHEN OLD.mark IS NOT NEW.mark AND 'kept' IN (OLD.mark, NEW.mark)
    BEGIN ${refreshKept(inProject('NEW.project_id', '(SELECT via_role FROM projects WHERE id = NEW.project_id)'))} END`);
  // A fact that leaves a kept project (moved by hand, by Talk, or as its project is deleted with its facts kept) stays
  // kept: the project's mark is written onto it first.
  db.run(`CREATE TRIGGER fact_left_kept AFTER UPDATE OF role_id, project_id ON facts
    WHEN (OLD.role_id IS NOT NEW.role_id OR OLD.project_id IS NOT NEW.project_id) AND ${inKept('OLD.role_id', 'OLD.project_id')}
    BEGIN ${keepSql('id = OLD.id', 'left-kept-project', leftRef, `(SELECT ${nameOf('x.title', 'x.via_role')} FROM projects x WHERE x.id = ${leftRef})`)} END`);
  // A kept project that is deleted writes kept onto every fact still in it (its row deleted, a carried row gone).
  db.run(`CREATE TRIGGER project_kept_gone BEFORE DELETE ON projects
    WHEN EXISTS (SELECT 1 FROM project_standing WHERE project_id = OLD.id AND mark = 'kept')
    BEGIN ${keepSql('project_id = OLD.id OR (OLD.via_role IS NOT NULL AND role_id = OLD.via_role)', 'kept-project-deleted', 'OLD.id', nameOf('OLD.title', 'OLD.via_role'))} END`);
  // kept_words in full, from the marks as they stand.
  db.run('DELETE FROM kept_words');
  db.run(`INSERT INTO kept_words (fact_id, key) SELECT k.id, ${sqlKey('k.text')} FROM facts k WHERE ${isRootSql('k')}`);
}).immediate();

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (s: string) => MONTH.test(s);
const projectExists = (id: number) => db.query('SELECT 1 FROM projects WHERE id = ?').get(id) !== null;
const factExists = (id: number) => db.query('SELECT 1 FROM facts WHERE id = ?').get(id) !== null;
const ensureProject = (id: number) => db.query('INSERT OR IGNORE INTO project_standing (project_id) VALUES (?)').run(id);
const ensureFact = (id: number) => db.query('INSERT OR IGNORE INTO fact_standing (fact_id) VALUES (?)').run(id);
// Runs a change under the write lock, so the row it checks cannot go before it writes.
const write = <T>(f: () => T): T => db.transaction(f).immediate();

// ---------- Dates and state ----------

export type ProjectStanding = { projectId: number; lastWorked: string; state: WorkState; mark: ProjectMark | ''; place: number | null };
type StandingRow = { project_id: number; last_worked: string; state: string; mark: string; place: number | null };
const toStanding = (r: StandingRow): ProjectStanding =>
  ({ projectId: r.project_id, lastWorked: r.last_worked, state: r.state as WorkState, mark: r.mark as ProjectMark | '', place: r.place });

// A project with no row yet reads as not said: no month, state unknown, unmarked, not placed by the owner.
export function projectStanding(projectId: number): ProjectStanding {
  const r = db.query('SELECT * FROM project_standing WHERE project_id = ?').get(projectId) as StandingRow | null;
  return r ? toStanding(r) : { projectId, lastWorked: '', state: 'unknown', mark: '', place: null };
}

// Sets what the owner said about a project's work. A field left out is left as it was. Returns '' or why it was refused.
export function setProjectWork(projectId: number, w: { lastWorked?: string; state?: WorkState }, now = Date.now()): string {
  if (w.lastWorked !== undefined && w.lastWorked !== '' && !isMonth(w.lastWorked)) return 'Write the month as YYYY-MM.';
  if (w.state !== undefined && !(STATES as readonly string[]).includes(w.state)) return 'That is not a state of work.';
  return write(() => {
    if (!projectExists(projectId)) return 'That project is not in the record.';
    ensureProject(projectId);
    if (w.lastWorked !== undefined) db.query('UPDATE project_standing SET last_worked = ?, changed_at = ? WHERE project_id = ?').run(w.lastWorked, now, projectId);
    if (w.state !== undefined) db.query('UPDATE project_standing SET state = ?, changed_at = ? WHERE project_id = ?').run(w.state, now, projectId);
    return '';
  });
}

// A fact's own month, or '' to take its project's or its role's dates again.
export function setFactMonth(factId: number, month: string, now = Date.now()): string {
  if (month !== '' && !isMonth(month)) return 'Write the month as YYYY-MM.';
  return write(() => {
    if (!factExists(factId)) return 'That fact is not in the record.';
    ensureFact(factId);
    db.query('UPDATE fact_standing SET month = ?, changed_at = ? WHERE fact_id = ?').run(month, now, factId);
    return '';
  });
}

const allRoles = () => db.query('SELECT * FROM roles').all() as RoleRow[];
const allProjects = () => db.query('SELECT * FROM projects').all() as ProjectRow[];
type FactPlace = { role_id: number | null; project_id: number | null };
const factPlace = (id: number) => db.query('SELECT role_id, project_id FROM facts WHERE id = ?').get(id) as FactPlace | null;

// The project a fact is in, as the tree places it (lib/tree.ts). A fact of a carried project (a repository's project
// group, a side project) has no project_id: its role_id is the project's row.
export function projectOfFact(factId: number): number | null {
  const f = factPlace(factId);
  return f ? placeOf(f, allRoles(), allProjects()).project : null;
}

// A project's start and end as the record holds them: its own, or for a carried project its row's.
function projectDates(p: ProjectRow, roles: RoleRow[]): { start: string; end: string } {
  if (p.via_role === null) return { start: p.start, end: p.end };
  const row = roles.find((r) => r.id === p.via_role);
  return row ? { start: row.start, end: row.end } : { start: '', end: '' };
}

export type When = { start: string; end: string; from: 'fact' | 'project' | 'role' | 'none' };
// When a fact happened: its own month (start and end both that month), else its project's dates, else its role's.
// Dates that are both empty count as none, so the next level is tried. An empty end with a start is the present,
// as everywhere in the record.
export function factWhen(factId: number): When {
  const f = factPlace(factId);
  if (!f) return { start: '', end: '', from: 'none' };
  const own = (db.query('SELECT month FROM fact_standing WHERE fact_id = ?').get(factId) as { month: string } | null)?.month ?? '';
  if (own !== '') return { start: own, end: own, from: 'fact' };
  const roles = allRoles(), projects = allProjects();
  const at = placeOf(f, roles, projects);
  const p = at.project === null ? undefined : projects.find((x) => x.id === at.project);
  if (p) {
    const d = projectDates(p, roles);
    if (d.start !== '' || d.end !== '') return { ...d, from: 'project' };
  }
  const r = at.role === null ? undefined : roles.find((x) => x.id === at.role);
  if (r && (r.start !== '' || r.end !== '')) return { start: r.start, end: r.end, from: 'role' };
  return { start: '', end: '', from: 'none' };
}

// ---------- Visibility ----------

// Whether a surface may use something with this mark. The switches are exhaustive: a new mark or surface fails to
// compile until it is decided here.
export function allows(mark: Mark, surface: Surface): boolean {
  switch (surface) {
    // The public assistant reads only the collection the owner saved (lib/public.ts), never the record. No mark lets
    // it read a fact here; `public` only offers a fact for the draft of that collection (publicOffered below).
    case 'answer': return false;
    case 'resume': case 'profile': case 'message':
      switch (mark) {
        case 'kept': return false;
        case 'public': case 'documents': return true;
        default: return never(mark);
      }
    default: return never(surface);
  }
}
function never(x: never): never { throw new Error(`Not handled: ${String(x)}`); }

// What the owner approved when they marked a fact public: its text, detail and metric exactly as they stood.
export const approvalOf = (f: { text: string; detail: string; metric: string }) =>
  createHash('sha256').update(JSON.stringify([f.text, f.detail, f.metric])).digest('hex');

// '' clears the owner's mark. A project is never public: mark its facts instead (markFactsPublic).
export function setProjectMark(projectId: number, mark: ProjectMark | '', now = Date.now()): string {
  if ((mark as string) === 'public') return 'A project is not marked public. Mark its facts public, one by one or all at once.';
  if (mark !== '' && !(PROJECT_MARKS as readonly string[]).includes(mark)) return 'That is not a mark.';
  return write(() => {
    if (!projectExists(projectId)) return 'That project is not in the record.';
    ensureProject(projectId);
    db.query('UPDATE project_standing SET mark = ?, changed_at = ? WHERE project_id = ?').run(mark, now, projectId);
    // Its facts' words are kept wherever else they stand while it is kept, and no longer for it once it is not.
    const ids = (db.query('SELECT id FROM facts WHERE project_id = ?1 OR role_id = (SELECT via_role FROM projects WHERE id = ?1)').all(projectId) as { id: number }[]).map((f) => f.id);
    if (mark === 'kept') spreadSameWords(keysOf(ids), now); else unspreadSameWords(ids, now);
    return '';
  });
}

type Words = { text: string; detail: string; metric: string };
const wordsOf = (id: number) => db.query('SELECT text, detail, metric FROM facts WHERE id = ?').get(id) as Words | null;
// Writes the owner's mark on one fact that exists. Called under the write lock.
function markFact(factId: number, f: Words, mark: Mark | '', now: number): void {
  ensureFact(factId);
  db.query("UPDATE fact_standing SET mark = ?, marked_by = ?, approved = ?, reason = '', reason_ref = NULL, reason_name = '', changed_at = ? WHERE fact_id = ?")
    .run(mark, mark === '' ? '' : 'owner', mark === 'public' ? approvalOf(f) : '', now, factId);
  // Kept: every other fact with the same words is kept too. No longer kept: the copies kept for it are cleared.
  if (mark === 'kept') spreadSameWords(new Set([norm(f.text)]), now); else unspreadSameWords([factId], now);
}

// The owner's mark on a fact; '' clears it. Marking public records what was approved, so a later rewording is not
// offered until the owner marks it again. A mark never changes the fact's status or its words.
export function setFactMark(factId: number, mark: Mark | '', now = Date.now()): string {
  if (mark !== '' && !(MARKS as readonly string[]).includes(mark)) return 'That is not a mark.';
  return write(() => {
    const f = wordsOf(factId);
    if (!f) return 'That fact is not in the record.';
    // The same words cannot be usable here and kept back elsewhere: the owner clears the other mark first.
    const other = mark === 'public' || mark === 'documents' ? keptElsewhere(factId, f.text) : null;
    if (other !== null) return `These words are kept back on ${factRef(other)}. Clear that mark first.`;
    markFact(factId, f, mark, now);
    // A told fact the owner marked is theirs (lib/derive.ts): deriving again keeps it, and so never brings its words back
    // unmarked. A source's fact keeps its status: a reading again carries its mark (carryFacts below).
    if (mark !== '') db.query("UPDATE facts SET status = 'confirmed' WHERE id = ? AND told = 1").run(factId);
    return '';
  });
}

// Marks public every fact the tree shows in a project now, one by one. A fact that is kept is left as it is, and a
// kept project is refused. A fact added to the project later is not marked. Returns the facts marked.
export function markFactsPublic(projectId: number, now = Date.now()): { ok: true; marked: number[] } | { ok: false; error: string } {
  return write(() => {
    if (!projectExists(projectId)) return { ok: false as const, error: 'That project is not in the record.' };
    if (projectStanding(projectId).mark === 'kept') return { ok: false as const, error: 'That project is kept. Change its mark first.' };
    const roles = allRoles(), projects = allProjects();
    const facts = db.query('SELECT id, role_id, project_id FROM facts ORDER BY id').all() as ({ id: number } & FactPlace)[];
    const marked: number[] = [];
    for (const f of facts) {
      if (placeOf(f, roles, projects).project !== projectId || factMark(f.id).mark === 'kept' || keptElsewhere(f.id, wordsOf(f.id)!.text) !== null) continue;
      markFact(f.id, wordsOf(f.id)!, 'public', now);
      marked.push(f.id);
    }
    return { ok: true as const, marked };
  });
}

export function projectMark(projectId: number): Mark {
  const m = projectStanding(projectId).mark;
  return m === '' ? DEFAULT_MARK : m;
}

const inKeptProject = (f: FactPlace) => (db.query(`SELECT ${inKept('?1', '?2')} AS kept`).get(f.role_id, f.project_id) as { kept: number }).kept === 1;

// A fact's mark, where it came from, and (for its own mark) who set it. kept wins at every level: the fact's own kept,
// then a kept project, both before the fact's own public or documents. A project's documents mark gives the fact
// nothing it would not have anyway; it is reported so the owner can see why.
export function factMark(factId: number): { mark: Mark; from: 'fact' | 'project' | 'default'; by: MarkedBy | '' } {
  const f = factPlace(factId);
  const own = db.query('SELECT mark, marked_by FROM fact_standing WHERE fact_id = ?').get(factId) as { mark: Mark | ''; marked_by: MarkedBy | '' } | null;
  if (own?.mark === 'kept') return { mark: 'kept', from: 'fact', by: own.marked_by };
  if (f && inKeptProject(f)) return { mark: 'kept', from: 'project', by: '' };
  if (own && own.mark !== '') return { mark: own.mark, from: 'fact', by: own.marked_by };
  const p = f ? placeOf(f, allRoles(), allProjects()).project : null;
  if (p !== null && projectStanding(p).mark === 'documents') return { mark: 'documents', from: 'project', by: '' };
  return { mark: DEFAULT_MARK, from: 'default', by: '' };
}

// May this surface use this fact? A fact that is not in the record may not be used anywhere, and the public assistant
// ('answer') may never use one (allows above).
export function mayUse(factId: number, surface: Surface): boolean {
  if (!factExists(factId)) return false;
  return allows(factMark(factId).mark, surface);
}

// Every fact that is kept, by its own mark or through a kept project: factMark's rule for all facts in one query, for a
// reader of the whole record (lib/you.ts). mayUse(id, surface) is false for exactly these on every surface but 'answer'.
export const keptFacts = (): Set<number> =>
  new Set((db.query(`SELECT k.id FROM facts k WHERE EXISTS (SELECT 1 FROM fact_standing r WHERE r.fact_id = k.id AND r.mark = 'kept') OR ${inKept('k.role_id', 'k.project_id')}`).all() as { id: number }[]).map((r) => r.id));
// Every project the owner marked kept.
export const keptProjects = (): Set<number> => new Set((db.query("SELECT project_id FROM project_standing WHERE mark = 'kept'").all() as { project_id: number }[]).map((r) => r.project_id));

// The facts offered for the draft of the public collection: marked public by the owner, not kept by any rule above,
// and with text, detail and metric still exactly as the owner approved them. A fact reworded since (by a reading
// through `replaces`, by Talk, by an edit) waits until the owner marks it again. Only the words are approved: a fact
// moved to another role, or given other skills or evidence, is still offered, since none of that is in its words.
export function publicOffered(): { id: number; text: string; detail: string; metric: string }[] {
  const rows = db.query("SELECT f.id, f.text, f.detail, f.metric, s.approved FROM facts f JOIN fact_standing s ON s.fact_id = f.id WHERE s.mark = 'public' ORDER BY f.id").all() as
    (Words & { id: number; approved: string })[];
  return rows.filter((r) => r.approved !== '' && approvalOf(r) === r.approved && factMark(r.id).mark === 'public')
    .map((r) => ({ id: r.id, text: r.text, detail: r.detail, metric: r.metric }));
}

// ---------- Carrying marks across a reading again and a fold (lib/db.ts) ----------

type Held = { id: number; text: string; mark: Mark | ''; marked_by: MarkedBy | ''; month: string; approved: string; reason: ToolReason | ''; reason_ref: number | null; reason_name: string; changed_at: number; kept: boolean; via: { id: number; name: string } | null };
// What a fact has to carry, read before it is deleted: its own row, and whether it is kept (and through which project).
const heldOf = (id: number): Held | null => {
  const row = db.query('SELECT mark, marked_by, month, approved, reason, reason_ref, reason_name, changed_at FROM fact_standing WHERE fact_id = ?').get(id) as
    Omit<Held, 'id' | 'text' | 'kept' | 'via'> | null;
  const kept = factMark(id).mark === 'kept';
  if (!row && !kept) return null;
  const text = (db.query('SELECT text FROM facts WHERE id = ?').get(id) as { text: string }).text;
  const f = factPlace(id)!;
  const via = row?.mark === 'kept' ? null : db.query(`SELECT x.id, ${nameOf('x.title', 'x.via_role')} AS name FROM projects x WHERE x.id = (${keptOf('?1', '?2')} ORDER BY x.id LIMIT 1)`).get(f.role_id, f.project_id) as { id: number; name: string } | null;
  return { id, text, mark: row?.mark ?? '', marked_by: row?.marked_by ?? '', month: row?.month ?? '', approved: row?.approved ?? '', reason: row?.reason ?? '',
    reason_ref: row?.reason_ref ?? null, reason_name: row?.reason_name ?? '', changed_at: row?.changed_at ?? 0, kept, via };
};
// Writes kept onto facts as the tool's mark, with why. A fact already kept keeps who marked it and why.
function markKeptByTool(ids: number[], reason: ToolReason, ref: number, name: string, now: number): void {
  for (const id of ids) {
    ensureFact(id);
    db.query(`UPDATE fact_standing SET marked_by = 'tool', reason = ?, reason_ref = ?, reason_name = ?, changed_at = ?, mark = 'kept', approved = ''
      WHERE fact_id = ? AND mark != 'kept'`).run(reason, ref, name, now, id);
  }
}

// ---------- The same words as a kept fact ----------

// A kept fact's words are kept wherever else they stand in the record, as facts of their own: another source's copy, a
// fact the owner typed again, a fact reworded to them. Each copy is the tool's mark (same-words-as-kept), pointing at
// the first fact with those words that is kept in its own right. The triggers above do this for each new or reworded
// fact; the functions here do it when a mark changes, and compare with norm() itself.

// Whether a fact is kept in its own right: by a mark that is not itself a same-words copy, or through a kept project.
function isRoot(id: number): boolean {
  const own = db.query('SELECT mark, marked_by, reason FROM fact_standing WHERE fact_id = ?').get(id) as { mark: string; marked_by: string; reason: string } | null;
  if (own?.mark === 'kept' && !(own.marked_by === 'tool' && own.reason === 'same-words-as-kept')) return true;
  const f = factPlace(id);
  return f !== null && inKeptProject(f);
}
// The first other fact with these words (by norm) that is kept in its own right, or null.
function keptElsewhere(factId: number, text: string): number | null {
  const key = norm(text);
  for (const f of db.query('SELECT id, text FROM facts WHERE id != ? ORDER BY id').all(factId) as { id: number; text: string }[]) if (norm(f.text) === key && isRoot(f.id)) return f.id;
  return null;
}
const keysOf = (ids: number[]) => new Set(ids.map((id) => (db.query('SELECT text FROM facts WHERE id = ?').get(id) as { text: string } | null)?.text).filter((t): t is string => t !== undefined).map(norm));
// Marks kept every fact that says one of these wordings, when a fact with that wording is kept in its own right.
function spreadSameWords(keys: Set<string>, now: number): void {
  if (keys.size === 0) return;
  const byKey = new Map<string, { id: number; text: string }[]>();
  for (const f of db.query('SELECT id, text FROM facts ORDER BY id').all() as { id: number; text: string }[]) {
    const key = norm(f.text);
    if (keys.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  for (const list of byKey.values()) {
    const root = list.find((f) => isRoot(f.id));
    if (!root) continue;
    for (const f of list) if (f.id !== root.id && factMark(f.id).mark !== 'kept') markKeptByTool([f.id], 'same-words-as-kept', root.id, root.text, now);
  }
}
// When facts are no longer kept in their own right, the copies kept for them are cleared in the same transaction, then
// kept again for any other fact with the same words that still is.
function unspreadSameWords(ids: number[], now: number): void {
  const keys = keysOf(ids);
  for (const id of ids) {
    if (isRoot(id)) continue;
    for (const c of db.query("SELECT f.text FROM fact_standing s JOIN facts f ON f.id = s.fact_id WHERE s.marked_by = 'tool' AND s.reason = 'same-words-as-kept' AND s.reason_ref = ?").all(id) as { text: string }[]) keys.add(norm(c.text));
    db.query(`UPDATE fact_standing SET ${CLEAR} WHERE marked_by = 'tool' AND reason = 'same-words-as-kept' AND reason_ref = ?`).run(now, id);
  }
  spreadSameWords(keys, now);
}

carryFacts({
  table: 'fact_standing',
  // A fact made again with the same words takes the old row as it was: mark, who set it and why, month and approval
  // (copied, not made again, so a changed detail is not offered). A fact kept only through its project is written kept,
  // since the new row is made outside any project of its role. A kept fact with no successor in the same words holds
  // the whole reading (held, and HeldReading in lib/db.ts): the reading is not applied and nothing changes.
  // Words the reading said but did not write (`skipped`) are a successor too, so such a reading is never held for ever:
  // - a confirmed fact already says them: that fact becomes kept (same-words-as-kept), so the words stay kept;
  // - the owner deleted that wording: after the reading the kept fact is gone as well, which is what deleting the
  //   words asked for.
  reread: (old: CarriedFact[]) => {
    // For each wording, the facts that had it, kept ones first, so they are the first to find a successor.
    const held = new Map<string, Held[]>();
    for (const f of old) {
      const h = heldOf(f.id);
      if (!h) continue;
      const list = held.get(f.key) ?? [];
      if (h.kept) list.unshift(h); else list.push(h);
      held.set(f.key, list);
    }
    return {
      held: (made: CarriedFact[], rewritten: number[], skipped: Skipped[]) => {
        const count = new Map<string, number>();
        for (const f of made) count.set(f.key, (count.get(f.key) ?? 0) + 1);
        for (const f of skipped) count.set(f.key, Infinity);
        const lost = [...held].flatMap(([key, list]) => list.filter((h, i) => h.kept && i >= (count.get(key) ?? 0)).map((h) => ({ id: h.id, text: h.text })));
        if (lost.length === 0) return [];
        // A kept wording with no successor holds the reading only if something the reading wrote would be usable after
        // it: when every fact it made or rewrote lands kept (in a kept project, as a same-words copy, or as the successor
        // of a kept fact, matched as carry below matches them), the lost words cannot get out, and the reading goes on.
        const willKeep = new Set<number>();
        for (const [key, list] of held) {
          const same = made.filter((f) => f.key === key);
          list.forEach((h, i) => { if (h.kept && i < same.length) willKeep.add(same[i].id); });
        }
        const open = [...made.map((f) => f.id), ...rewritten].filter((id) => !willKeep.has(id) && factMark(id).mark !== 'kept');
        return open.length === 0 ? [] : lost;
      },
      carry: (made: CarriedFact[], rewritten: number[]) => {
        const now = Date.now();
        for (const f of made) {
          const h = held.get(f.key)?.shift();
          if (!h) continue;
          ensureFact(f.id);
          db.query('UPDATE fact_standing SET mark = ?, marked_by = ?, month = ?, approved = ?, reason = ?, reason_ref = ?, reason_name = ?, changed_at = ? WHERE fact_id = ?')
            .run(h.mark, h.marked_by, h.month, h.approved, h.reason, h.reason_ref, h.reason_name, h.changed_at, f.id);
          if (h.kept && h.via) markKeptByTool([f.id], 'left-kept-project', h.via.id, h.via.name, now);
        }
        // A kept fact whose words the reading skipped (held above lets it through): every fact still saying them is kept.
        for (const [key, list] of held) {
          for (const h of list.filter((x) => x.kept)) {
            for (const f of db.query('SELECT id, text FROM facts').all() as { id: number; text: string }[]) {
              if (norm(f.text) === key && factMark(f.id).mark !== 'kept') markKeptByTool([f.id], 'same-words-as-kept', h.id, h.text, now);
            }
          }
        }
        // The same words as a kept fact elsewhere in the record (another source, the owner's own) are kept here too.
        spreadSameWords(keysOf([...made.map((f) => f.id), ...rewritten]), now);
      },
    };
  },
  // A duplicate that is kept makes the fact that stays kept.
  // The fold often gives the fact that stays the duplicate's words first, so the trigger has already kept it as a
  // same-words copy of that duplicate: the fold is the truer reason, and replaces it.
  fold: (keepId: number, drop: number[]) => {
    const kept = drop.find((id) => factMark(id).mark === 'kept');
    if (kept === undefined) return;
    const words = (db.query('SELECT text FROM facts WHERE id = ?').get(kept) as { text: string }).text, now = Date.now();
    db.query(`UPDATE fact_standing SET reason = 'folded-kept-duplicate', reason_ref = ?, reason_name = ?, changed_at = ?
      WHERE fact_id = ? AND marked_by = 'tool' AND reason = 'same-words-as-kept' AND reason_ref IN (${drop.map(Number).join(',')})`).run(kept, words, now, keepId);
    markKeptByTool([keepId], 'folded-kept-duplicate', kept, words, now);
  },
});

// ---------- The tool's marks, for the owner to see and undo ----------

// When a same-words copy's reason ends. The copy is kept because it says the words of a fact kept in its own right.
// - The copy is reworded away from those words: it is no longer a copy, and its mark clears.
// - The kept fact is reworded: its copies follow it only where they still say its words; a copy that no longer does
//   moves to another kept fact that says its words, or its mark clears.
// - The kept fact is cleared by the owner: its copies clear too (unspreadSameWords), in the same transaction.
// - The kept fact is deleted: its copies stay kept, listed with its words. Deleting a fact removes that row; it is not
//   a decision that its words may now be used, and a copy elsewhere may be the only place they still stand. The owner
//   sees them here and clears them as a group (clearToolMarks with the deleted fact's id).

export type ToolMark = { factId: number; words: string; reason: ToolReason; refId: number | null; refName: string; at: number };
// Every mark the tool set, grouped by why and what it refers to, so the owner can see each and undo a group at once.
// Clearing a project's kept mark clears nothing here by itself: the facts it wrote kept stay listed until cleared.
export const toolMarks = (): ToolMark[] =>
  (db.query("SELECT s.fact_id, f.text, s.reason, s.reason_ref, s.reason_name, s.changed_at FROM fact_standing s JOIN facts f ON f.id = s.fact_id WHERE s.marked_by = 'tool' ORDER BY s.reason, s.reason_ref, s.fact_id").all() as
    { fact_id: number; text: string; reason: ToolReason; reason_ref: number | null; reason_name: string; changed_at: number }[])
    .map((r) => ({ factId: r.fact_id, words: r.text, reason: r.reason, refId: r.reason_ref, refName: r.reason_name, at: r.changed_at }));

const CLEAR = "mark = '', marked_by = '', reason = '', reason_ref = NULL, reason_name = '', changed_at = ?";
// Clears every mark the tool set for one reason and one project or fact. Returns how many. A fact still in a kept
// project stays kept through it.
export function clearToolMarks(reason: ToolReason, refId: number | null, now = Date.now()): number {
  if (!(TOOL_REASONS as readonly string[]).includes(reason)) return 0;
  // Counted first: bun:sqlite's count of changes includes what the triggers changed in other rows.
  return write(() => {
    const n = (db.query("SELECT count(*) AS n FROM fact_standing WHERE marked_by = 'tool' AND reason = ? AND reason_ref IS ?").get(reason, refId) as { n: number }).n;
    db.query(`UPDATE fact_standing SET ${CLEAR} WHERE marked_by = 'tool' AND reason = ? AND reason_ref IS ?`).run(now, reason, refId);
    return n;
  });
}
// Clears one mark the tool set. A mark the owner set is not touched. Returns whether one was cleared.
export const clearToolMark = (factId: number, now = Date.now()) => write(() => {
  const was = db.query("SELECT 1 FROM fact_standing WHERE marked_by = 'tool' AND fact_id = ?").get(factId) !== null;
  db.query(`UPDATE fact_standing SET ${CLEAR} WHERE marked_by = 'tool' AND fact_id = ?`).run(now, factId);
  return was;
});

// ---------- Rank ----------

// What the order is made from, one item per project. lastWorked is YYYY-MM or ''. months and commits are the size of
// the work: months worked, and the owner's commits in the repositories tied to it. ownerPlace is where the owner put
// it (1 is first), or null.
export type RankItem = { id: number; state: WorkState; lastWorked: string; months: number; commits: number; ownerPlace: number | null };

const STATE_ORDER: Record<WorkState, number> = { running: 0, ended: 1, unknown: 2, off: 3 };

// The order of the projects the owner has not placed:
// 1. state: running, then ended, then unknown, then off (work that runs says the most about the owner now). A project
//    whose state the owner has not said, and that is current by the record's own convention, counts as running here
//    (currentByRecord below, applied in rankItems);
// 2. the most recent last work first; a project with no month comes after every project with one;
// 3. the longer work first (months worked), then the more commits;
// 4. the lower id first, so the same input always gives the same order.
export function autoOrder(a: RankItem, b: RankItem): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.lastWorked === '' ? 1 : 0) - (b.lastWorked === '' ? 1 : 0)
    || b.lastWorked.localeCompare(a.lastWorked)
    || b.months - a.months
    || b.commits - a.commits
    || a.id - b.id;
}

// One ordered list of project ids. Pure: no database, no clock. No score leaves this function, only the order.
// The places are filled from the first: a project the owner put at place p takes slot p, and every slot the owner did
// not take goes to the next of the other projects in autoOrder. So an owner place of 3 among 5 projects lands third,
// with two others ahead of it. Two owner places on the same slot keep the lower id first, and the other moves down
// one. An owner place past the end of the list lands as late as the list allows, still after every project the owner
// put earlier.
export function rank(items: RankItem[]): number[] {
  const owned = items.filter((i) => i.ownerPlace !== null).sort((a, b) => a.ownerPlace! - b.ownerPlace! || a.id - b.id);
  const rest = items.filter((i) => i.ownerPlace === null).sort(autoOrder);
  const out: number[] = [];
  let o = 0, r = 0;
  while (o < owned.length || r < rest.length) {
    const slot = out.length + 1;
    // An owner project is due once its slot is reached, or at once when no other project is left to put before it.
    if (o < owned.length && (owned[o].ownerPlace! <= slot || r >= rest.length)) out.push(owned[o++].id);
    else out.push(rest[r++].id);
  }
  return out;
}

const ym = (s: string) => (s.length === 4 ? `${s}-01` : s.slice(0, 7));
// Months from start to end, both counted: 2024-01 to 2024-03 is 3. A start of only a year counts from its January.
// An empty end is the present only while the work is running (today is passed in, YYYY-MM): set so by the owner, or
// current by the record's own convention (currentByRecord). Otherwise the size is not known and counts as 0. Nothing
// here guesses a date the owner did not give.
export function monthsWorked(start: string, end: string, state: WorkState, today: string): number {
  const s = ym(start), e = end !== '' ? ym(end) : state === 'running' ? today : '';
  if (!isMonth(s) || !isMonth(e)) return 0;
  const n = (Number(e.slice(0, 4)) - Number(s.slice(0, 4))) * 12 + Number(e.slice(5, 7)) - Number(s.slice(5, 7)) + 1;
  return Math.max(0, n);
}

// The repository table belongs to lib/repoactivity.ts, which may not have been imported.
const reposTable = () => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'repo_activity'").get() !== null;

// Whether a project is current by the record's own convention, where a role with a start and an empty end is current
// ("Present"). Read each time and never stored: it is used only while the owner has not said the project's state, and
// a state they set always wins (rankItems).
// - The project has no end of its own (a project's own end, or a carried project's row's end, keeps it ended).
// - The role it belongs to is a role (lib/tree.ts) with an empty end: for a project in a role, that role; for a carried
//   project, the role its row is filed under. A side project or a repository nobody placed has no role: no row says it
//   is current, so it stays as the owner left it (unknown).
// - There is a start: the project's own, or, for a project with no dates of its own, its role's. With neither, nothing
//   says when the work began, and nothing is guessed.
export function currentByRecord(p: ProjectRow, roles: RoleRow[]): boolean {
  const own = projectDates(p, roles);
  if (own.end !== '') return false;
  let roleId = p.role_id;
  if (p.via_role !== null) {
    const row = roles.find((r) => r.id === p.via_role);
    if (!row || levelOf(row, roles) !== 'project') return false;
    roleId = row.part_of;
  }
  const role = roles.find((r) => r.id === roleId);
  if (!role || levelOf(role, roles) !== 'role' || role.end !== '') return false;
  return own.start !== '' || (p.via_role === null && p.start === '' && role.start !== '');
}

// The rank's input for every project in the record, read from the database. today is YYYY-MM.
// state is the owner's, or running for a project current by the record (currentByRecord) whose state they have not
// said. lastWorked is the owner's month, else today for such a current project, else the project's end, else the month
// of the owner's last commit in a repository tied to it (lib/repoactivity.ts). months counts a current project's own
// dates up to today; a project with no start of its own has no size (0), even when its role's start made it current.
// commits sums the owner's commits in the repositories tied to the project, or to the `roles` row a carried project
// points at.
export function rankItems(today: string): RankItem[] {
  const roles = allRoles(), projects = allProjects();
  const standing = new Map((db.query('SELECT * FROM project_standing').all() as StandingRow[]).map((r) => [r.project_id, toStanding(r)]));
  const repos = reposTable() ? db.query('SELECT role_id, project_id, last_commit, commits FROM repo_activity').all() as { role_id: number | null; project_id: number | null; last_commit: string; commits: number }[] : [];
  return projects.map((p) => {
    const s = standing.get(p.id), d = projectDates(p, roles), said = s?.state ?? 'unknown';
    const current = said === 'unknown' && currentByRecord(p, roles), state: WorkState = current ? 'running' : said;
    const mine = repos.filter((x) => x.project_id === p.id || (p.via_role !== null && x.role_id === p.via_role));
    const lastCommit = mine.map((x) => x.last_commit.slice(0, 7)).filter(isMonth).sort().at(-1) ?? '';
    const lastWorked = s?.lastWorked || (current ? today : '') || (isMonth(ym(d.end)) ? ym(d.end) : '') || lastCommit;
    return { id: p.id, state, lastWorked, months: monthsWorked(d.start, d.end, state, today), commits: mine.reduce((n, x) => n + x.commits, 0), ownerPlace: s?.place ?? null };
  });
}

// The owner puts a project at a place, or takes it back (null) so the tool places it again.
export function placeProject(projectId: number, place: number | null, now = Date.now()): string {
  if (place !== null && (!Number.isInteger(place) || place < 1)) return 'A place is a whole number from 1.';
  return write(() => {
    if (!projectExists(projectId)) return 'That project is not in the record.';
    ensureProject(projectId);
    db.query('UPDATE project_standing SET place = ?, changed_at = ? WHERE project_id = ?').run(place, now, projectId);
    return '';
  });
}

// The order now, first to last: each project's place in it and who set it. Only the owner's places are stored; the
// tool's are worked out here each time from rank(), so this always agrees with rank() and never goes stale.
export const placed = (today: string) =>
  rank(rankItems(today)).map((id, i) => ({ projectId: id, place: i + 1, placedBy: (projectStanding(id).place !== null ? 'owner' : 'tool') as 'owner' | 'tool' }));
