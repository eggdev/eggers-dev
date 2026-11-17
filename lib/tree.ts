// The record as one tree: Role → Project → Fact, with side projects beside the roles and "General" for facts that
// belong to no role. A pure module: the rows are passed in, and nothing here opens the database or asks a model.
//
// Where each kind of information lives:
// - A role is a `roles` row at the level `role` (levelOf below). Its official record is that row: employer, title,
//   start, end, employment type (a view of standing and label) and location, each with a mark in `official`.
// - A project is a `projects` row. A repository's project group, a side project and a repository nobody placed are
//   `roles` rows too, as the resume pipeline has always read them: their project points at the row (`via_role`), and
//   takes its name and dates from it. Any other project lives in its role (`projects.role_id`).
// - A fact is a `facts` row. Its role is `role_id`; in a project of its role it also has `project_id`, and with none
//   it is in the role's "Day to day". A fact of a carried project has that project's row as its `role_id`.
// The tool never guesses: a row whose level is unknown is `unplaced`, and stays so until the person places it.
import type { RoleRow } from './db.ts';

export type Level = 'role' | 'project' | 'side' | 'unplaced';
export type Marks = Partial<Record<'company' | 'title' | 'start' | 'end' | 'type' | 'location', 'hr' | 'memory'>>;
export type TreeRoleRow = RoleRow & { official?: string };
export type ProjectRow = { id: number; role_id: number | null; via_role: number | null; title: string; start: string; end: string; lives: string; situation: string; did: string; result: string; learned: string };
export type FactLean = { id: number; role_id: number | null; project_id: number | null; text: string; metric: string; kind: string };

// The level of a `roles` row, by the rules the resume pipeline already uses: a row filed under an existing role is
// that role's project (timeline.ts and linkedin.ts leave it out of the jobs); a personal project is a side project;
// a row with no title that is not the person's own company or contract work is a repository nobody has placed; any
// other row is a role. lib/tree.test.ts holds this equal to timeline's jobs and to LinkedIn's.
export function levelOf(row: RoleRow, roles: RoleRow[]): Level {
  if (row.part_of !== null && row.part_of !== row.id && roles.some((r) => r.id === row.part_of)) return 'project';
  if (row.standing === 'personal') return 'side';
  if (row.title.trim() === '' && row.standing !== 'own' && row.standing !== 'contract') return 'unplaced';
  return 'role';
}

// Reference numbers (DESIGN.md section 4), from the database id and never from a position.
export const roleRef = (id: number | string) => `R-${String(id).padStart(2, '0')}`;
export const projectRef = (id: number | string) => `P-${String(id).padStart(3, '0')}`;
export const factRef = (id: number | string) => `F-${String(id).padStart(4, '0')}`;

// Employment type, as a view of standing and label (no column of its own). "Full-time" is not offered: the record
// cannot tell it from Employee, and a label is printed on resumes.
export type Employment = '' | 'employee' | 'contract' | 'part-time' | 'own';
export const employmentOf = (r: { standing: string; label?: string }): Employment =>
  (r.label ?? '') === 'Part-time' ? 'part-time' : (r.label ?? '') === 'Contract' || r.standing === 'contract' ? 'contract' : r.standing === 'own' ? 'own' : r.standing === 'employer' ? 'employee' : '';
// What to store for an employment type. Part-time keeps the row an employer's.
export const employmentFields = (e: Employment, standing: string): { standing: string; label: string } =>
  e === 'part-time' ? { standing: standing === '' || standing === 'contract' ? 'employer' : standing, label: 'Part-time' }
  : e === 'contract' ? { standing: 'contract', label: '' }
  : e === 'own' ? { standing: 'own', label: '' }
  : e === 'employee' ? { standing: 'employer', label: '' }
  : { standing: '', label: '' };

export const marksOf = (official: string | undefined): Marks => {
  try {
    const o = JSON.parse(official ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([k, v]) => ['company', 'title', 'start', 'end', 'type', 'location'].includes(k) && (v === 'hr' || v === 'memory'))) as Marks;
  } catch { return {}; }
};

// Newest first; a row with no start yet comes first, so a role just added without dates is not lost at the bottom.
const ym = (s: string) => (s === '' ? '' : s.length === 4 ? `${s}-01` : s);
const newestFirst = <T extends { id: number; start: string }>(a: T, b: T) =>
  (a.start === '' ? 1 : 0) !== (b.start === '' ? 1 : 0) ? (a.start === '' ? -1 : 1) : ym(b.start).localeCompare(ym(a.start)) || b.id - a.id;
// Inside a role, a project with no dates yet goes last, beside where projects are added.
const datedFirst = <T extends { id: number; start: string }>(a: T, b: T) =>
  (a.start === '' ? 1 : 0) - (b.start === '' ? 1 : 0) || ym(b.start).localeCompare(ym(a.start)) || a.id - b.id;

export type TreeRole = { id: string; ref: string; title: string; company: string; start: string; end: string; location: string; employment: Employment; standing: string; reach: string; label: string; note: string; marks: Marks };
// place: role (in a role), side (the person's own), unplaced (a repository nobody placed). carried: its name and dates
// are a `roles` row's.
export type TreeProject = { id: string; ref: string; roleId: string; place: 'role' | 'side' | 'unplaced'; carried: boolean; title: string; start: string; end: string; lives: string; situation: string; did: string; result: string; learned: string };
// roleId '' and projectId '' is General; roleId alone is the role's Day to day.
export type TreeFact = { id: string; ref: string; roleId: string; projectId: string; text: string; metric: string; kind: string };
export type Tree = { roles: TreeRole[]; projects: TreeProject[]; facts: TreeFact[] };

// Where a fact sits in the tree, by its row: { role, project } as numbers, null for none.
export function placeOf(f: { role_id: number | null; project_id: number | null }, rows: TreeRoleRow[], projects: ProjectRow[]): { role: number | null; project: number | null } {
  const levels = new Map(rows.map((r) => [r.id, levelOf(r, rows)]));
  const carried = projects.find((p) => p.via_role !== null && p.via_role === f.role_id && levels.has(p.via_role) && levels.get(p.via_role) !== 'role');
  if (carried) {
    const row = rows.find((r) => r.id === carried.via_role)!;
    return { role: levels.get(row.id) === 'project' ? row.part_of : null, project: carried.id };
  }
  if (f.role_id === null || levels.get(f.role_id) !== 'role') return { role: null, project: null };
  const native = projects.find((p) => p.id === f.project_id && p.via_role === null && p.role_id === f.role_id);
  return { role: f.role_id, project: native ? native.id : null };
}

export function tree(rows: TreeRoleRow[], projects: ProjectRow[], facts: FactLean[]): Tree {
  const levels = new Map(rows.map((r) => [r.id, levelOf(r, rows)]));
  const roles = rows.filter((r) => levels.get(r.id) === 'role').sort(newestFirst);
  const roleIds = new Set(roles.map((r) => r.id));
  const shown: (TreeProject & { n: number; s: string })[] = [];
  for (const p of projects) {
    if (p.via_role !== null) {
      const row = rows.find((r) => r.id === p.via_role);
      const level = row ? levels.get(row.id)! : 'role';
      // A carried row that has since become a role (the person gave it a title) shows as that role.
      if (!row || level === 'role') continue;
      const parent = level === 'project' && roleIds.has(row.part_of!) ? String(row.part_of) : '';
      shown.push({ id: String(p.id), ref: projectRef(p.id), roleId: parent, place: parent !== '' ? 'role' : level === 'side' ? 'side' : 'unplaced', carried: true,
        title: row.company, start: row.start, end: row.end, lives: p.lives, situation: p.situation, did: p.did, result: p.result, learned: p.learned, n: p.id, s: row.start });
    } else {
      const parent = p.role_id !== null && roleIds.has(p.role_id) ? String(p.role_id) : '';
      shown.push({ id: String(p.id), ref: projectRef(p.id), roleId: parent, place: parent !== '' ? 'role' : 'unplaced', carried: false,
        title: p.title, start: p.start, end: p.end, lives: p.lives, situation: p.situation, did: p.did, result: p.result, learned: p.learned, n: p.id, s: p.start });
    }
  }
  // Projects in roles first, then side projects, then the unplaced; each group in its own order.
  const rank = { role: 0, side: 1, unplaced: 2 };
  const ordered = [...shown].sort((a, b) => rank[a.place] - rank[b.place] || (a.place === 'role' ? datedFirst : newestFirst)({ id: a.n, start: a.s }, { id: b.n, start: b.s }));
  return {
    roles: roles.map((r) => ({ id: String(r.id), ref: roleRef(r.id), title: r.title, company: r.company, start: r.start, end: r.end, location: r.location, employment: employmentOf(r),
      standing: r.standing, reach: r.reach, label: r.label ?? '', note: r.note ?? '', marks: marksOf(r.official) })),
    projects: ordered.map(({ n: _n, s: _s, ...p }) => p),
    facts: [...facts].sort((a, b) => a.id - b.id).map((f) => {
      const at = placeOf(f, rows, projects);
      return { id: String(f.id), ref: factRef(f.id), roleId: at.role === null ? '' : String(at.role), projectId: at.project === null ? '' : String(at.project), text: f.text, metric: f.metric, kind: f.kind };
    }),
  };
}
