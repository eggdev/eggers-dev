// Questions for what the record is missing (DESIGN.md section 8): one raised kind, `record` (lib/raised.ts). Code
// finds each gap; only the owner can fill it, so each becomes a stored question that says what it asks. An answer,
// "I don't know" and "I don't remember" included, is kept and never asked again (raise leaves answered ones alone).
//
// The six rows, in the order Home takes them (at most HOME_RECORD of them open there at once):
// 1. record:place:<row>    a repository nobody placed: one of your employers', or your own side project? → part_of, or personal
// 2. record:start:<role>   a role with no start date → roles.start
// 3. record:empty:<role>   a role with nothing in it → settled on the role (no choices)
// 4. record:part:<p>:<part> a project's result, then what the owner did, then the situation; one open per project → that part
// 5. record:baseline:<fact> the number before, for a measured fact an unsent job leans on → facts.baseline
// 6. record:own:<fact>     the owner's own part, for the same facts → facts.own_part
// Rows 5 and 6 are at most BEST_OPEN open together. What I learned is never asked.
import { db, type RoleRow } from './db.ts';
import { inventory } from './metrics.ts';
import { onAnswer, raise, type Finding, type Raised } from './raised.ts';
import { levelOf, type ProjectRow } from './tree.ts';

export const HOME_RECORD = 7, BEST_OPEN = 3;
const PART_ORDER = ['result', 'did', 'situation'] as const;
type Part = (typeof PART_ORDER)[number];

export type GapFact = { id: number; role_id: number | null; project_id: number | null; text: string; metric: string; baseline: string; own_part: string };
// What the gaps are found in: the rows as stored, the facts an unsent job names as its best evidence and that are in
// the metrics inventory (lib/metrics.ts), and the keys already answered.
export type GapInput = { roles: RoleRow[]; projects: ProjectRow[]; facts: GapFact[]; best: Set<number>; answered: Set<string> };
// A question as raise() takes it, with what Home needs: rank (its place in Home's order) and route (where its item is).
export type Gap = Finding & { data: { kind: string; rank: number; route: string; actions: { field: string; value?: string; input?: string }[]; subject: number; part?: string } };

const q = (s: string) => `“${s.replace(/[.!?]+$/, '')}”`;
const name = (r: RoleRow) => (r.title ? `${r.title} at ${r.company}` : r.company);
// A fact that already says where its number started ("from 47 to 9 minutes", "6 hours to 40 minutes") has a baseline.
const saysFromTo = (s: string) => /\bfrom\b.*\bto\b/i.test(s) || /\d[\d.,%$a-z ]*\bto\b\s*[$]?\d/i.test(s);

export function recordGaps(input: GapInput): Gap[] {
  const { roles, projects, facts, best, answered } = input;
  const level = new Map(roles.map((r) => [r.id, levelOf(r, roles)]));
  // The roles, newest added first. The order of a question's choices must not change when a role's dates do (an answer
  // to another question can set a start date): an answer names its choice by place (and its words, lib/raised.ts).
  const jobs = roles.filter((r) => level.get(r.id) === 'role').sort((a, b) => b.id - a.id);
  const carried = new Map(projects.filter((p) => p.via_role !== null).map((p) => [p.via_role!, p]));
  const out: Gap[] = [];
  const push = (row: number, g: Omit<Gap, 'data'> & { data: Omit<Gap['data'], 'rank'> }) => { if (!answered.has(g.key)) out.push({ ...g, data: { ...g.data, rank: row * 100_000 + out.length } }); };
  // 1. A repository nobody placed.
  for (const r of roles.filter((x) => level.get(x.id) === 'unplaced')) {
    const p = carried.get(r.id);
    const same = (c: string) => jobs.filter((j) => j.company === c).length > 1;
    push(1, { key: `record:place:${r.id}`, text: `Was ${r.company} work for one of your employers, or your own project?`, about: `role:${r.id}`,
      choices: [...jobs.map((j) => `Done at ${j.company}${same(j.company) ? ` (${j.title})` : ''}`), 'My own side project'],
      data: { kind: 'place', subject: r.id, route: p ? `/record/project/${p.id}` : '/record', actions: [...jobs.map((j) => ({ field: 'part_of', value: String(j.id) })), { field: 'standing', value: 'personal' }] } });
  }
  // 2. A role with no start date.
  for (const r of jobs.filter((x) => x.start === '')) {
    push(2, { key: `record:start:${r.id}`, text: `When did you start as ${r.title} at ${r.company}?`, about: `role:${r.id}`, choices: ['Give the month', 'I don’t remember'],
      data: { kind: 'start', subject: r.id, route: `/record/role/${r.id}`, actions: [{ field: 'start', input: 'month' }, { field: 'none' }] } });
  }
  // 3. A role with nothing in it: no fact, and no project.
  for (const r of jobs.filter((x) => !facts.some((f) => f.role_id === x.id) && !projects.some((p) => p.role_id === x.id || (p.via_role !== null && roles.find((c) => c.id === p.via_role)?.part_of === x.id)))) {
    push(3, { key: `record:empty:${r.id}`, text: `What did you do as ${r.title} at ${r.company}? This role has nothing in it yet.`, about: `role:${r.id}`, choices: [],
      data: { kind: 'empty', subject: r.id, route: `/record/role/${r.id}`, actions: [] } });
  }
  // 4. A project's missing part: its result, then what the owner did, then the situation. One open per project.
  for (const p of projects) {
    const row = p.via_role !== null ? roles.find((r) => r.id === p.via_role) : undefined;
    if (p.via_role !== null && (!row || level.get(row.id) === 'role')) continue;
    // A repository nobody placed is asked where it belongs first; its parts wait until the owner has said.
    if (row && level.get(row.id) === 'unplaced') continue;
    if (p.via_role === null && (p.role_id === null || level.get(p.role_id) !== 'role')) continue;
    const title = row ? row.company : p.title;
    const part = PART_ORDER.find((k) => p[k] === '' && !answered.has(`record:part:${p.id}:${k}`));
    if (!part) continue;
    const text = { result: `What came of ${q(title)}?`, did: `What did you do yourself in ${q(title)}?`, situation: `What was going on before you started ${q(title)}?` }[part];
    push(4, { key: `record:part:${p.id}:${part}`, text, about: `project:${p.id}`, choices: ['Write it in one line', 'I don’t know'],
      data: { kind: 'part', subject: p.id, part, route: `/record/project/${p.id}`, actions: [{ field: part, input: 'line' }, { field: 'none' }] } });
  }
  // 5 and 6. For a measured fact an unsent job leans on: the number before, then the owner's own part. At most a few.
  const leaned = facts.filter((f) => best.has(f.id)).sort((a, b) => a.id - b.id);
  const asks: Gap[] = [];
  for (const f of leaned) {
    if (f.baseline === '' && !saysFromTo(`${f.text} ${f.metric}`) && !answered.has(`record:baseline:${f.id}`))
      asks.push({ key: `record:baseline:${f.id}`, text: `${f.text} What was the number before?`, about: `fact:${f.id}`, choices: ['Give it', 'There was none', 'I don’t know'],
        data: { kind: 'baseline', subject: f.id, rank: 0, route: `/record/fact/${f.id}`, actions: [{ field: 'baseline', input: 'line' }, { field: 'baseline', value: 'There was none' }, { field: 'none' }] } });
  }
  for (const f of leaned) {
    if (f.own_part === '' && !answered.has(`record:own:${f.id}`))
      asks.push({ key: `record:own:${f.id}`, text: `${f.text} What was your own part?`, about: `fact:${f.id}`, choices: ['Write it in one line', 'I don’t know'],
        data: { kind: 'own', subject: f.id, rank: 0, route: `/record/fact/${f.id}`, actions: [{ field: 'own_part', input: 'line' }, { field: 'none' }] } });
  }
  for (const a of asks.slice(0, BEST_OPEN)) push(a.key.startsWith('record:baseline:') ? 5 : 6, a);
  return out;
}

// The facts an unsent job names as its best evidence that are also measured results (the metrics inventory).
export function bestEvidence(): Set<number> {
  const named = new Set<number>();
  for (const j of db.query("SELECT analysis FROM jobs WHERE resume != '' AND outcome = '' AND analysis != ''").all() as { analysis: string }[]) {
    try { for (const r of (JSON.parse(j.analysis).requirements ?? []) as { best?: string }[]) { const m = /^fact:(\d+)$/.exec(r.best ?? ''); if (m) named.add(Number(m[1])); } } catch { /* an analysis that does not read names nothing */ }
  }
  const measured = new Set(inventory(db.query("SELECT id, role_id, metric FROM facts WHERE metric != ''").all() as { id: number; role_id: number | null; metric: string }[]).map((m) => m.fact));
  return new Set([...named].filter((id) => measured.has(id)));
}

export function gapInput(): GapInput {
  return {
    roles: db.query('SELECT * FROM roles').all() as RoleRow[],
    projects: db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[],
    facts: db.query('SELECT id, role_id, project_id, text, metric, baseline, own_part FROM facts ORDER BY id').all() as GapFact[],
    best: bestEvidence(),
    answered: new Set((db.query("SELECT key FROM raised_questions WHERE kind = 'record' AND answered_at > 0").all() as { key: string }[]).map((r) => r.key)),
  };
}

// Brings the record's questions in step with the record. Called beside syncQuestions (lib/checks.ts) wherever it runs:
// the server's follow-up after a change, and the worker after a reading and at start.
export const syncRecordQuestions = (now: number) => raise('record', recordGaps(gapInput()), now);

// What an answer writes: exactly the one value its row names, and only while the gap is still there. "I don't know"
// and "I don't remember" write nothing: the answer alone is kept.
onAnswer('record', (q: Raised, choice: number, value: string, now: number) => {
  const d = q.data as Gap['data'];
  const act = d.actions?.[choice];
  if (!act || act.field === 'none') return '';
  const v = act.value ?? value.trim();
  if (act.input === 'line' && v === '') return 'Write it in one line.';
  if (d.kind === 'place') {
    const row = db.query('SELECT * FROM roles WHERE id = ?').get(d.subject) as RoleRow | null;
    if (!row) return 'That repository is no longer in your record.';
    const rows = db.query('SELECT * FROM roles').all() as RoleRow[];
    if (levelOf(row, rows) !== 'unplaced') return 'That repository has been placed since. Look at it again.';
    if (act.field === 'part_of') {
      const to = rows.find((r) => r.id === Number(v));
      if (!to || levelOf(to, rows) !== 'role') return 'That role is no longer in your record.';
      db.query('UPDATE roles SET part_of = ? WHERE id = ?').run(to.id, row.id);
    } else db.query("UPDATE roles SET standing = 'personal' WHERE id = ?").run(row.id);
    return '';
  }
  if (d.kind === 'start') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return 'Give the start as a year and a month, like 2021-03.';
    const month = new Date(now), thisMonth = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    if (v > thisMonth) return 'That month has not come yet.';
    const rows = db.query('SELECT * FROM roles').all() as RoleRow[], role = rows.find((r) => r.id === d.subject);
    if (!role) return 'That role is no longer in your record.';
    if (levelOf(role, rows) !== 'role') return 'That is no longer one of your roles. Look at it again.';
    if (role.end !== '' && role.end < v.slice(0, role.end.length)) return 'That start is after the job’s end date.';
    if (role.start !== '') return 'That role has a start date now. Look at it again.';
    if (role.start === '') db.query('UPDATE roles SET start = ? WHERE id = ?').run(v, d.subject);
    return '';
  }
  if (d.kind === 'part') {
    const part = d.part as Part;
    if (!PART_ORDER.includes(part)) return '';
    if (!db.query('SELECT id FROM projects WHERE id = ?').get(d.subject)) return 'That project is no longer in your record.';
    db.query(`UPDATE projects SET ${part} = ? WHERE id = ? AND ${part} = ''`).run(v, d.subject);
    return '';
  }
  if (d.kind === 'baseline' || d.kind === 'own') {
    const col = d.kind === 'baseline' ? 'baseline' : 'own_part';
    if (!db.query('SELECT id FROM facts WHERE id = ?').get(d.subject)) return 'That fact is no longer in your record.';
    db.query(`UPDATE facts SET ${col} = ? WHERE id = ? AND ${col} = ''`).run(v, d.subject);
    return '';
  }
  return '';
});
