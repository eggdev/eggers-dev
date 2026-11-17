// Projects proposed for a role, from the facts in its Day to day (DESIGN.md section 8). Never automatic: the owner asks
// on a role (POST /roles/:id/propose), the worker makes one model request, and what comes back is checked here, in
// code, before anything is shown. The model proposes only a title, which of the facts sent belong to it, and which one
// of those facts states the result. It proposes no dates and no parts: those would be claims a model wrote.
//
// Nothing a proposal says reaches the record until the owner keeps it. Keep checks it again against the record as it
// is then, makes the project and files the facts in it. The facts keep their role, so the record's signature, and so
// every resume, stays as it was. A result is never written until the owner says the fact states it.
import { db, type RoleRow } from './db.ts';
import { ask } from './llm.ts';
import { numbersIn } from './metrics.ts';
import { setStage } from './activity.ts';
import { factRef, levelOf } from './tree.ts';

// Suggestions are offered on a role with at least this many facts in Day to day.
export const PROPOSE_FROM = 6;
export const MAX_TITLE = 80, MAX_EDITED_TITLE = 200, MAX_DETAIL = 400;

export type SentFact = { key: string; text: string; metric: string; kind: string; detail: string };
// What is sent: the role as context, its unfiled facts, the titles its projects already have, and the titles the owner
// said are not projects (never proposed again).
export type Request = { role: string; dates: string; facts: SentFact[]; projects: string[]; rejected: string[] };
export type Raw = { projects: { title: string; facts: string[]; result: string }[] };
export type Checked = { title: string; facts: number[]; result: number };

type FactRow = { id: number; role_id: number | null; project_id: number | null; kind: string; text: string; metric: string; detail: string };
type ProposalRow = { id: number; role_id: number; run: number; title: string; fact_ids: string; result_fact: number; status: string; project_id: number | null; result_state: string; created_at: number; decided_at: number };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// A title is one line: no control or format character (a tab, a zero-width space) and no line or paragraph separator.
export const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const roleRow = (id: number) => db.query('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | null;
const isRole = (id: number) => { const rows = db.query('SELECT * FROM roles').all() as RoleRow[], r = rows.find((x) => x.id === id); return !!r && levelOf(r, rows) === 'role'; };
const dayFacts = (roleId: number) => db.query('SELECT id, role_id, project_id, kind, text, metric, detail FROM facts WHERE role_id = ? AND project_id IS NULL ORDER BY id').all(roleId) as FactRow[];
const projectTitles = (roleId: number) => (db.query('SELECT title FROM projects WHERE role_id = ? AND via_role IS NULL').all(roleId) as { title: string }[]).map((p) => p.title)
  .concat((db.query('SELECT company AS title FROM roles WHERE part_of = ?').all(roleId) as { title: string }[]).map((p) => p.title));
const rejectedTitles = (roleId: number) => (db.query("SELECT title FROM project_proposals WHERE role_id = ? AND status = 'rejected' ORDER BY id").all(roleId) as { title: string }[]).map((p) => p.title);

export function requestFor(roleId: number): Request {
  const r = roleRow(roleId)!;
  return { role: `${r.title} at ${r.company}`, dates: r.start === '' ? '' : `${r.start} to ${r.end === '' ? 'now' : r.end}`,
    facts: dayFacts(roleId).map((f) => ({ key: `fact:${f.id}`, text: f.text, metric: f.metric, kind: f.kind, detail: f.detail.slice(0, MAX_DETAIL) })),
    projects: projectTitles(roleId), rejected: rejectedTitles(roleId) };
}

export const SCHEMA = { type: 'object', additionalProperties: false, required: ['projects'], properties: {
  projects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'facts', 'result'],
    properties: { title: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } }, result: { type: 'string' } } } } } };

export function prompt(r: Request): string {
  return `You are helping one person sort the facts recorded about one of their jobs into the projects they worked on.

The job, for context only: ${r.role}${r.dates ? `, ${r.dates}` : ''}.

Below are the facts recorded for this job that are not in any project yet, each with its key. Group into a project only facts that are plainly about the same piece of work: one system, one launch, one change, one problem solved. Many facts are day-to-day work and belong to no project; leave those out. Propose a project only when at least two facts belong to it, and never put one fact in two projects. When no project stands out, return an empty list.

For each project return:
- "title": a short name for the work, one line, at most ${MAX_TITLE} characters, in the person's own terms. Use only words the facts support. A number may appear in the title only if it appears in one of that project's facts.
- "facts": the keys of the facts that belong to it, exactly as given.
- "result": the key of the one fact among them that states what came of the work, or "" when none does.

Propose no dates, no situation, no description and no result in your own words: the person writes those.
${r.projects.length ? `\nThis job already has these projects; do not propose them again under any wording:\n${r.projects.map((t) => `- ${t}`).join('\n')}\n` : ''}${r.rejected.length ? `\nThe person said these are not projects; do not propose them again under any wording:\n${r.rejected.map((t) => `- ${t}`).join('\n')}\n` : ''}
The facts, as JSON:
${JSON.stringify(r.facts)}`;
}

// The checks, in code. A proposal that fails one is dropped whole, never repaired by a guess. The one change made is
// the plan's: a fact proposed for two projects is taken out of both, since it can belong to only one.
export function checkProposals(raw: Raw, sent: SentFact[], titles: string[]): Checked[] {
  const facts = new Map(sent.map((f) => [f.key, f]));
  const list = (Array.isArray(raw?.projects) ? raw.projects : []).map((p) => ({
    title: typeof p?.title === 'string' ? p.title.trim() : '', keys: Array.isArray(p?.facts) ? [...new Set(p.facts)] : [], result: typeof p?.result === 'string' ? p.result : '' }));
  // Every key must be one that was sent: a proposal naming any other is dropped.
  const known = list.filter((p) => p.keys.length > 0 && p.keys.every((k) => typeof k === 'string' && facts.has(k)));
  const seen = new Map<string, number>();
  for (const p of known) for (const k of p.keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  const taken = new Set(titles.map(norm)), out: Checked[] = [];
  for (const p of known) {
    const keys = p.keys.filter((k) => seen.get(k) === 1);
    if (keys.length < 2) continue;
    if (p.title === '' || NOT_ONE_LINE.test(p.title) || p.title.length > MAX_TITLE) continue;
    const has = new Set(keys.flatMap((k) => { const f = facts.get(k)!; return numbersIn(`${f.text} ${f.metric} ${f.detail}`); }));
    if (!numbersIn(p.title).every((n) => has.has(n))) continue;
    if (taken.has(norm(p.title))) continue;
    if (p.result !== '' && !keys.includes(p.result)) continue;
    taken.add(norm(p.title));
    out.push({ title: p.title, facts: keys.map((k) => Number(k.slice(5))), result: p.result === '' ? 0 : Number(p.result.slice(5)) });
  }
  return out;
}

// Keeps what passed as this role's open proposals. Those of an earlier request that were never decided go: the new
// request read the same facts again. Kept and rejected ones stay (the rejected titles are sent next time).
export function storeProposals(roleId: number, checked: Checked[], now: number): number {
  return db.transaction(() => {
    const run = ((db.query('SELECT max(run) AS n FROM project_proposals WHERE role_id = ?').get(roleId) as { n: number | null }).n ?? 0) + 1;
    db.query("DELETE FROM project_proposals WHERE role_id = ? AND status IN ('open', 'stale')").run(roleId);
    for (const c of checked) db.query('INSERT INTO project_proposals (role_id, run, title, fact_ids, result_fact, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(roleId, run, c.title, JSON.stringify(c.facts), c.result, now);
    return checked.length;
  }).immediate();
}

// The owner asks for proposals on a role. '' when asked, else why not.
export function askFor(roleId: number): string {
  if (!Number.isInteger(roleId) || !roleRow(roleId) || !isRole(roleId)) return 'That role is no longer in your record.';
  const status = (roleRow(roleId)!.propose_status as string | undefined) ?? '';
  if (status === 'queued' || status === 'running') return 'Projects are being suggested for this role now.';
  if (dayFacts(roleId).length < PROPOSE_FROM) return `Suggestions need at least ${PROPOSE_FROM} facts in this role’s Day to day.`;
  db.query("UPDATE roles SET propose_status = 'queued', propose_note = '' WHERE id = ?").run(roleId);
  return '';
}

// The worker's part: one model request, the checks, and the store. The status column moves the activity log.
export async function proposeFor(roleId: number, cwd: string, now = () => Date.now()): Promise<number> {
  setStage('propose-projects', roleId, 'Reading the role’s facts');
  const req = requestFor(roleId);
  setStage('propose-projects', roleId, 'Grouping the facts into projects');
  const raw = await ask<Raw>({ cwd, schema: SCHEMA, prompt: prompt(req), timeoutMs: 5 * 60_000, model: process.env.EGG_PROPOSE_MODEL ?? process.env.EGG_MODEL ?? 'sonnet' });
  setStage('propose-projects', roleId, 'Checking the suggestions');
  // Checked against the record as it is now, in case it changed while the model was asked.
  const fresh = requestFor(roleId);
  const ok = checkProposals(raw, fresh.facts, [...fresh.projects, ...fresh.rejected]);
  return storeProposals(roleId, ok, now());
}

// The worker's whole step for one queued request: running, the request, then done (with how many) or failed (with why).
// The status column moves the activity log. A failure changes nothing in the record.
export async function runQueued(cwd: string, now = () => Date.now()): Promise<boolean> {
  const role = db.query("SELECT id FROM roles WHERE propose_status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | null;
  if (!role) return false;
  db.query("UPDATE roles SET propose_status = 'running', propose_note = '' WHERE id = ?").run(role.id);
  try {
    const n = await proposeFor(role.id, cwd, now);
    db.query("UPDATE roles SET propose_status = 'done', propose_note = ? WHERE id = ?").run(n === 0 ? 'No project stood out in these facts' : `${n} project${n === 1 ? '' : 's'} suggested`, role.id);
    console.log(`propose: ${n} projects suggested for role ${role.id}`);
  } catch (e) {
    db.query("UPDATE roles SET propose_status = 'failed', propose_note = ? WHERE id = ?").run((e as Error).message, role.id);
    console.log(`propose: failed: ${(e as Error).message}`);
  }
  return true;
}

// ---------- What the screens read and the owner decides ----------

export type ProposalView = { id: string; title: string; facts: { id: string; ref: string; text: string }[]; result: string; status: 'open' | 'stale'; staleNote: string };
const idsOf = (p: ProposalRow) => (JSON.parse(p.fact_ids) as number[]).filter((n) => Number.isInteger(n));
// Which of a proposal's facts are no longer unfiled facts of its role (moved, filed, deleted).
function moved(p: ProposalRow): number[] {
  const here = new Set(dayFacts(p.role_id).map((f) => f.id));
  return idsOf(p).filter((id) => !here.has(id));
}
export function proposalsOf(roleId: number): ProposalView[] {
  const rows = db.query("SELECT * FROM project_proposals WHERE role_id = ? AND status IN ('open', 'stale') ORDER BY id").all(roleId) as ProposalRow[];
  return rows.map((p) => {
    const gone = moved(p), facts = idsOf(p).map((id) => db.query('SELECT id, text FROM facts WHERE id = ?').get(id) as { id: number; text: string } | null).filter((f) => f !== null);
    const stale = p.status === 'stale' || gone.length > 0;
    return { id: String(p.id), title: p.title, facts: facts.map((f) => ({ id: String(f!.id), ref: factRef(f!.id), text: f!.text })), result: p.result_fact > 0 ? String(p.result_fact) : '',
      status: stale ? 'stale' : 'open', staleNote: stale ? `This suggestion is out of date: ${gone.length === 1 ? '1 of its facts has' : `${gone.length} of its facts have`} moved or been deleted since. Edit it to keep the rest, or say it is not a project.` : '' };
  });
}
// The roles with proposals waiting for the owner, for Home.
export const openProposalRoles = (): { role: number; n: number; name: string }[] =>
  (db.query("SELECT p.role_id AS role, count(*) AS n, CASE WHEN r.title != '' THEN r.title || ' at ' || r.company ELSE r.company END AS name FROM project_proposals p JOIN roles r ON r.id = p.role_id WHERE p.status = 'open' GROUP BY p.role_id ORDER BY min(p.id)").all() as { role: number; n: number; name: string }[]);

export type Decided = { ok: true; project?: number } | { ok: false; error: string; status: number };
const no = (error: string, status = 400): Decided => ({ ok: false, error, status });

// Keep: as proposed, or with the owner's own title and facts (Edit). Checked again against the record as it is now.
// A proposal kept as proposed whose facts moved since is marked stale and nothing is applied.
export function keepProposal(id: number, b: Record<string, unknown>, now: number): Decided {
  const p = db.query('SELECT * FROM project_proposals WHERE id = ?').get(id) as ProposalRow | null;
  if (!p) return no('That suggestion is no longer there.', 404);
  if (p.status !== 'open' && p.status !== 'stale') return no('That suggestion was already decided.', 409);
  if (!isRole(p.role_id)) return no('That role is no longer in your record.', 409);
  const edited = typeof b.title === 'string' || Array.isArray(b.facts);
  const title = typeof b.title === 'string' ? b.title.trim() : p.title;
  if (title === '') return no('Write the project’s name.');
  if (NOT_ONE_LINE.test(title) || title.length > (typeof b.title === 'string' ? MAX_EDITED_TITLE : MAX_TITLE)) return no(`Keep the name to one line of at most ${MAX_EDITED_TITLE} characters.`);
  const ids = Array.isArray(b.facts) ? [...new Set(b.facts.map((x) => Number(x)))] : idsOf(p);
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n))) return no('Choose at least one fact for the project.');
  const here = new Set(dayFacts(p.role_id).map((f) => f.id));
  if (ids.some((n) => !here.has(n))) {
    if (!edited) db.query("UPDATE project_proposals SET status = 'stale' WHERE id = ? AND status = 'open'").run(id);
    return no(edited ? 'A fact you chose is no longer in this role’s Day to day. Choose again.' : 'Some of its facts have moved since it was suggested, so it was not kept. Edit it to keep the rest.', 409);
  }
  if (projectTitles(p.role_id).map(norm).includes(norm(title))) return no('This role already has a project with that name.', 409);
  let project = 0;
  db.transaction(() => {
    project = (db.query("INSERT INTO projects (role_id, title, origin, created_at) VALUES (?, ?, ?, ?) RETURNING id").get(p.role_id, title, `proposal:${p.id}`, now) as { id: number }).id;
    const marks = ids.map(() => '?').join(', ');
    // Filed facts are the owner's own placing: confirmed, so a later reading of their source keeps them. role_id is untouched.
    db.query(`UPDATE facts SET project_id = ?, status = 'confirmed' WHERE id IN (${marks}) AND role_id = ? AND project_id IS NULL`).run(project, ...ids, p.role_id);
    // The result stays a suggestion for the owner to confirm; one not among the kept facts is dropped.
    const result = ids.includes(p.result_fact) ? p.result_fact : 0;
    db.query("UPDATE project_proposals SET status = 'kept', project_id = ?, title = ?, fact_ids = ?, result_fact = ?, decided_at = ? WHERE id = ?").run(project, title, JSON.stringify(ids), result, now, id);
  }).immediate();
  return { ok: true, project };
}
export function rejectProposal(id: number, now: number): Decided {
  const p = db.query('SELECT * FROM project_proposals WHERE id = ?').get(id) as ProposalRow | null;
  if (!p) return no('That suggestion is no longer there.', 404);
  if (p.status !== 'open' && p.status !== 'stale') return no('That suggestion was already decided.', 409);
  db.query("UPDATE project_proposals SET status = 'rejected', decided_at = ? WHERE id = ?").run(now, id);
  return { ok: true };
}
// The suggested result of a kept project: used as its Result (only while it has none), or declined. Once only.
export function decideResult(id: number, use: boolean, now: number): Decided {
  const p = db.query('SELECT * FROM project_proposals WHERE id = ?').get(id) as ProposalRow | null;
  if (!p || p.status !== 'kept' || p.result_fact === 0 || p.result_state !== '') return no('There is no suggested result to decide.', 409);
  const fact = db.query('SELECT text, project_id FROM facts WHERE id = ?').get(p.result_fact) as { text: string; project_id: number | null } | null;
  if (use && !fact) return no('That fact is no longer in your record.', 409);
  // Only a fact still in the project can be its result.
  if (use && fact!.project_id !== p.project_id) return no('That fact is no longer in this project, so it cannot be its result.', 409);
  db.transaction(() => {
    if (use) db.query("UPDATE projects SET result = ? WHERE id = ? AND result = ''").run(fact!.text, p.project_id);
    db.query('UPDATE project_proposals SET result_state = ?, decided_at = ? WHERE id = ?').run(use ? 'used' : 'declined', now, id);
  })();
  return { ok: true, project: p.project_id ?? undefined };
}
// A kept project's result still waiting for the owner: its proposal and the fact's words, by project id.
export function suggestedResults(): Map<number, { proposal: number; text: string; fact: number }> {
  const rows = db.query("SELECT p.id, p.project_id, p.result_fact, f.text FROM project_proposals p JOIN facts f ON f.id = p.result_fact AND f.project_id = p.project_id JOIN projects j ON j.id = p.project_id WHERE p.status = 'kept' AND p.result_state = '' AND j.result = ''").all() as { id: number; project_id: number; result_fact: number; text: string }[];
  return new Map(rows.map((r) => [r.project_id, { proposal: r.id, text: r.text, fact: r.result_fact }]));
}
