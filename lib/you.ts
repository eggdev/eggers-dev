// The You screen's two read models (GET /you, GET /told). Both are built by code from the record; no model writes a word.
// 1. What stands out: the lines the owner wrote, then up to STAND_OUTS lines in all, one per project, in the one order
//    of projects (lib/standing.ts). A line the owner did not write is one of the project's own facts, chosen by a fixed
//    rule. The owner may write a line in their own words, or leave a project out; both are kept here by project, apart
//    from each other, and win over any later choice.
// 2. Everything you have told: the record as one document (roles newest first, as Experience shows them; under each its
//    projects with their four parts and facts, then the facts in no project), with the owner's words behind each fact
//    (lib/origins.ts). A fact with no words behind it has none listed; nothing marks it.
// Both show only what may be used on the profile (mayUse, lib/standing.ts): a kept fact or project is left out, and so
// is any of the owner's words that a kept fact was taken from (visibleOrigins).
import { db, type RoleRow } from './db.ts';
import { bestEvidence } from './gaps.ts';
import { type OriginKind } from './origins.ts';
import { keptFacts, keptProjects, placed } from './standing.ts';
import { placeOf, tree, type FactLean, type ProjectRow } from './tree.ts';

// The owner's own line for a project (text, '' for none) and, apart from it, the mark that the project is left out
// (left_out 1), and when either last changed. Leaving a project out keeps the owner's line, so restoring brings it back.
db.run(`CREATE TABLE IF NOT EXISTS stand_outs (
  project_id INTEGER PRIMARY KEY, text TEXT NOT NULL DEFAULT '', left_out INTEGER NOT NULL DEFAULT 0 CHECK (left_out IN (0, 1)), at INTEGER NOT NULL)`);
// A deleted project takes its line with it, and a new project never takes a line left behind under its id.
db.run('CREATE TRIGGER IF NOT EXISTS stand_outs_gone AFTER DELETE ON projects BEGIN DELETE FROM stand_outs WHERE project_id = OLD.id; END');
db.run('CREATE TRIGGER IF NOT EXISTS stand_outs_fresh AFTER INSERT ON projects BEGIN DELETE FROM stand_outs WHERE project_id = NEW.id; END');

export const STAND_OUTS = 4;
// The longest line the owner may write: one line, as the screen shows it.
export const MAX_LINE = 300;

type Fact = FactLean & { created_at: number };
const read = () => {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[], projects = db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  const facts = db.query('SELECT id, role_id, project_id, text, metric, kind, created_at FROM facts ORDER BY id').all() as Fact[];
  return { roles, projects, facts, shown: tree(roles, projects, facts) };
};

// ---------- What stands out ----------

// place: the line's place in the list, 1 first. factId: the fact the line was taken from, or for the owner's own line
// the fact the project would show ('' when it has none the profile may use). text: the fact's words, or the owner's
// own (edited true). metric: the fact's measured result, as stored ('' for the owner's own line).
export type StandOut = { place: number; factId: string; projectId: string; projectTitle: string; text: string; metric: string; edited: boolean; hasRecordLine: boolean };
type OwnLine = { project_id: number; text: string; left_out: number; at: number };

// The fact a project shows: among those the profile may use, one a saved job names as its best evidence (bestEvidence
// in lib/gaps.ts), else one with a measured result, else the first added. Facts come in id order.
export const pick = <T extends { id: number; metric: string }>(facts: T[], best: Set<number>): T | undefined =>
  facts.find((f) => best.has(f.id)) ?? facts.find((f) => f.metric.trim() !== '') ?? facts[0];

// Every line the owner wrote comes first, in the order of projects, wherever that order puts their project: their words
// never drop off the list. Lines chosen from the record then fill the places left, up to STAND_OUTS in all (none, when
// the owner wrote that many). A project left out, or kept back, gives no line, the owner's included.
// today is YYYY-MM: the order of projects counts a running project's months up to it (monthsWorked in lib/standing.ts).
export function standsOut(today: string): StandOut[] {
  const { roles, projects, facts, shown } = read();
  const titles = new Map(shown.projects.map((p) => [Number(p.id), p.title]));
  const own = new Map((db.query('SELECT * FROM stand_outs').all() as OwnLine[]).map((r) => [r.project_id, r]));
  const kept = keptFacts(), keptP = keptProjects();
  const byProject = new Map<number, Fact[]>();
  for (const f of facts) {
    const p = placeOf(f, roles, projects).project;
    if (p !== null && !kept.has(f.id)) byProject.set(p, [...(byProject.get(p) ?? []), f]);
  }
  const best = bestEvidence();
  // Left out by the owner, kept back, or a project the tree no longer shows (a carried row that became a role).
  const order = placed(today).map((x) => x.projectId).filter((id) => own.get(id)?.left_out !== 1 && titles.has(id) && !keptP.has(id));
  const line = (id: number, f: Fact | undefined) => ({ factId: f ? String(f.id) : '', hasRecordLine: f !== undefined, projectId: String(id), projectTitle: titles.get(id)! });
  const mine = order.filter((id) => (own.get(id)?.text ?? '') !== '')
    .map((id) => ({ ...line(id, pick(byProject.get(id) ?? [], best)), text: own.get(id)!.text, metric: '', edited: true }));
  const chosen = order.filter((id) => (own.get(id)?.text ?? '') === '').flatMap((id) => {
    const f = pick(byProject.get(id) ?? [], best);
    return f ? [{ ...line(id, f), text: f.text, metric: f.metric, edited: false }] : [];
  });
  return [...mine, ...chosen.slice(0, Math.max(0, STAND_OUTS - mine.length))].map((l, i) => ({ place: i + 1, ...l }));
}

// The projects the owner left out, in the order of projects, so the screen can offer each back (restore). hasOwnLine:
// the owner wrote a line before leaving it out, which restoring brings back. A kept project, or one the tree no longer
// shows, is not listed.
export type LeftOut = { projectId: string; projectTitle: string; hasOwnLine: boolean };
export function leftOut(today: string): LeftOut[] {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[], projects = db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  const titles = new Map(tree(roles, projects, []).projects.map((p) => [Number(p.id), p.title]));
  const own = new Map((db.query('SELECT * FROM stand_outs WHERE left_out = 1').all() as OwnLine[]).map((r) => [r.project_id, r]));
  if (own.size === 0) return [];
  const keptP = keptProjects();
  return placed(today).map((x) => x.projectId).filter((id) => own.has(id) && titles.has(id) && !keptP.has(id))
    .map((id) => ({ projectId: String(id), projectTitle: titles.get(id)!, hasOwnLine: own.get(id)!.text !== '' }));
}

const projectThere = (id: number) => Number.isInteger(id) && db.query('SELECT 1 FROM projects WHERE id = ?').get(id) !== null;

// The owner's own words for a project's line. Shown as written from then on; a later choice never replaces it. Writing
// a line for a project left out brings the project back. Returns '' when done, else why not.
export function setStandOut(projectId: number, text: string, now: number): string {
  const t = text.trim();
  if (t === '') return 'Write the line, or leave the project out.';
  if (t.length > MAX_LINE || /[\r\n]/.test(t)) return `Keep the line to one line of at most ${MAX_LINE} characters.`;
  if (!projectThere(projectId)) return 'That project is not in the record.';
  db.query('INSERT INTO stand_outs (project_id, text, left_out, at) VALUES (?, ?, 0, ?) ON CONFLICT (project_id) DO UPDATE SET text = excluded.text, left_out = 0, at = excluded.at')
    .run(projectId, t, now);
  return '';
}

// The owner leaves a project out: the next project takes its place. A line they wrote for it is kept, not shown.
export function leaveOut(projectId: number, now: number): string {
  if (!projectThere(projectId)) return 'That project is not in the record.';
  db.query("INSERT INTO stand_outs (project_id, text, left_out, at) VALUES (?, '', 1, ?) ON CONFLICT (project_id) DO UPDATE SET left_out = 1, at = excluded.at WHERE stand_outs.left_out = 0").run(projectId, now);
  return '';
}

// A project left out comes back with the owner's line, if they wrote one.
export function bringBack(projectId: number): string {
  if (!projectThere(projectId)) return 'That project is not in the record.';
  db.query('UPDATE stand_outs SET left_out = 0 WHERE project_id = ? AND left_out = 1').run(projectId);
  return '';
}

export function restore(projectId: number): string {
  return db.transaction(() => {
    if (!projectThere(projectId)) return 'That project is not in the record.';
    const r = db.query('SELECT * FROM stand_outs WHERE project_id = ?').get(projectId) as OwnLine | null;
    if (!r || r.left_out || !r.text) return '';
    const { roles, projects, facts } = read(), kept = keptFacts();
    if (keptProjects().has(projectId) || !facts.some((f) => !kept.has(f.id) && placeOf(f, roles, projects).project === projectId)) {
      return 'This project has no line in the record to use.';
    }
    db.query('DELETE FROM stand_outs WHERE project_id = ?').run(projectId);
    return '';
  }).immediate();
}

// ---------- Everything you have told ----------

// kind: talk | source | told | typed (lib/origins.ts). when: the day the words were written, in words ("Mar 3, 2026"),
// '' when unknown. quote: the words as they were copied.
export type ToldOrigin = { id: string; kind: OriginKind; when: string; quote: string };
export type ToldFact = { id: string; ref: string; text: string; metric: string; origins: ToldOrigin[] };
// parts: the project's four parts in CARL order, only those that hold words.
export type ToldProject = { id: string; ref: string; title: string; start: string; end: string; parts: { name: string; text: string }[]; facts: ToldFact[] };
export type ToldRole = { id: string; ref: string; title: string; company: string; start: string; end: string; projects: ToldProject[]; facts: ToldFact[] };
// roles: newest first. sides: the owner's own projects. unplaced: repositories nobody has placed yet. general: facts in
// no role. counts: what is shown, counted here; withWords is the facts shown with at least one origin.
export type Told = { roles: ToldRole[]; sides: ToldProject[]; unplaced: ToldProject[]; general: ToldFact[]; counts: { roles: number; projects: number; facts: number; withWords: number } };

const PARTS = [['context', 'Context'], ['action', 'Action'], ['result', 'Result'], ['learning', 'Learning']] as const;
// A day in words, as the server says a record's dates ("Mar 3, 2026").
export const day = (t: number) => (t > 0 ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(t) : '');
const has = (table: string) => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;
// When the words an origin points at were written: the Talk turn, the source, the answer in a sitting, or the fact as
// typed. The time the link was made is used only when that row says nothing.
function writtenAt(kind: OriginKind, refId: number, addedAt: number): number {
  const at = kind === 'talk' ? (has('talk') ? db.query('SELECT created_at AS t FROM talk WHERE id = ?').get(refId) : null)
    : kind === 'source' ? db.query('SELECT created_at AS t FROM sources WHERE id = ?').get(refId)
    : kind === 'told' ? (has('capture_turns') ? db.query('SELECT at AS t FROM capture_turns WHERE id = ?').get(refId) : null)
    : db.query('SELECT created_at AS t FROM facts WHERE id = ?').get(refId);
  const t = (at as { t: number } | null)?.t ?? 0;
  return t > 0 ? t : addedAt;
}

type OriginRow = { id: number; fact_id: number; kind: OriginKind; ref_id: number; span_start: number; span_end: number; quote: string; added_at: number };
// The origins that may be shown, by fact, for the facts not kept. A kept fact's words never leave the record: an origin
// of another fact is hidden, whole, when a kept fact has an origin on the same text (the same kind and row) whose span
// overlaps it. A whole message overlaps every passage of it, so two facts taken from one message show it only while
// neither is kept.
export function visibleOrigins(kept: Set<number> = keptFacts()): Map<number, OriginRow[]> {
  const rows = db.query('SELECT id, fact_id, kind, ref_id, span_start, span_end, quote, added_at FROM fact_origins ORDER BY id').all() as OriginRow[];
  const keptSpans = new Map<string, [number, number][]>();
  for (const r of rows) if (kept.has(r.fact_id)) keptSpans.set(`${r.kind}:${r.ref_id}`, [...(keptSpans.get(`${r.kind}:${r.ref_id}`) ?? []), [r.span_start, r.span_end]]);
  const out = new Map<number, OriginRow[]>(), seen = new Set<string>();
  for (const r of rows) {
    if (kept.has(r.fact_id)) continue;
    if ((keptSpans.get(`${r.kind}:${r.ref_id}`) ?? []).some(([s, e]) => s < r.span_end && r.span_start < e)) continue;
    const span = `${r.fact_id}:${r.kind}:${r.ref_id}:${r.span_start}:${r.span_end}`;
    if (seen.has(span)) continue;
    seen.add(span);
    out.set(r.fact_id, [...(out.get(r.fact_id) ?? []), r]);
  }
  return out;
}

export type ToldCounts = Told['counts'];
// The counts of told() without building it (GET /you): the same rules, read with a few queries. Every fact not kept is
// shown somewhere in told() (a fact placed in a kept project is itself kept), and every project the tree shows that is
// not kept is shown.
export function toldCounts(): ToldCounts {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[], projects = db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  const shown = tree(roles, projects, []), keptP = keptProjects(), kept = keptFacts();
  const facts = (db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n - kept.size;
  return { roles: shown.roles.length, projects: shown.projects.filter((p) => !keptP.has(Number(p.id))).length, facts, withWords: visibleOrigins(kept).size };
}

export function told(): Told {
  const { facts, shown } = read();
  const kept = keptFacts(), keptP = keptProjects(), words = visibleOrigins(kept);
  const usable = new Map(facts.filter((f) => !kept.has(f.id)).map((f) => [String(f.id), f]));
  const refs = new Map(shown.facts.map((f) => [f.id, f.ref]));
  const factOf = (id: string): ToldFact => {
    const f = usable.get(id)!;
    return { id, ref: refs.get(id)!, text: f.text, metric: f.metric,
      origins: (words.get(f.id) ?? []).map((o) => ({ id: String(o.id), kind: o.kind, when: day(writtenAt(o.kind, o.ref_id, o.added_at)), quote: o.quote })) };
  };
  const factsIn = (roleId: string, projectId: string) => shown.facts.filter((f) => f.roleId === roleId && f.projectId === projectId && usable.has(f.id)).map((f) => factOf(f.id));
  // A kept project is left out whole, its parts with its facts.
  const projects = shown.projects.filter((p) => !keptP.has(Number(p.id)));
  const projectOf = (p: (typeof projects)[number]): ToldProject => ({ id: p.id, ref: p.ref, title: p.title, start: p.start, end: p.end,
    parts: PARTS.filter(([k]) => p[k].trim() !== '').map(([k, name]) => ({ name, text: p[k] })), facts: factsIn(p.roleId, p.id) });
  const roles = shown.roles.map((r): ToldRole => ({ id: r.id, ref: r.ref, title: r.title, company: r.company, start: r.start, end: r.end,
    projects: projects.filter((p) => p.place === 'role' && p.roleId === r.id).map(projectOf), facts: factsIn(r.id, '') }));
  const sides = projects.filter((p) => p.place === 'side').map(projectOf), unplaced = projects.filter((p) => p.place === 'unplaced').map(projectOf);
  const general = factsIn('', '');
  const all = [...roles.flatMap((r) => [...r.facts, ...r.projects.flatMap((p) => p.facts)]), ...sides.flatMap((p) => p.facts), ...unplaced.flatMap((p) => p.facts), ...general];
  return { roles, sides, unplaced, general,
    counts: { roles: roles.length, projects: roles.reduce((n, r) => n + r.projects.length, 0) + sides.length + unplaced.length, facts: all.length, withWords: all.filter((f) => f.origins.length > 0).length } };
}
