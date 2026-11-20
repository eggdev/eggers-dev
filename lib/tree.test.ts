// `bun test lib`: the record as a tree (lib/tree.ts), with no database. The level of a row must agree with the rules
// the resume pipeline already uses to tell a job from a project (lib/timeline.ts and lib/linkedin.ts), so the tree
// never shows as a role what a resume leaves out, or the other way round. Every name here is invented.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { diffPositions } from './linkedin.ts';
import { timeline } from './timeline.ts';
import { employmentFields, employmentOf, factRef, levelOf, projectRef, roleRef, tree, type ProjectRow } from './tree.ts';

const row = (id: number, more: Partial<RoleRow>): RoleRow => ({ id, company: `Company ${id}`, title: '', start: '2021-01', end: '', location: '', summary: '', standing: '', reach: '', part_of: null, note: '', label: '', ...more });

// Every shape a row can take: with and without a title, each standing, filed under a role or not.
const ANCHOR = row(100, { company: 'Anchor Co', title: 'Lead', start: '2020-01', standing: 'employer' });
const PARENT = row(101, { company: 'Parent Co', title: 'Engineer', start: '2015-01', end: '2016-01', standing: 'employer' });
const CANDIDATES: RoleRow[] = [];
let n = 1;
for (const title of ['', 'Staff Engineer']) for (const standing of ['', 'employer', 'own', 'contract', 'personal']) for (const part_of of [null, 101]) {
  CANDIDATES.push(row(n++, { title, standing, part_of }));
}

test('a row is a role exactly when the timeline counts it a job, among rows filed under no role', () => {
  for (const x of CANDIDATES.filter((c) => c.part_of === null)) {
    const roles = [ANCHOR, PARENT, x];
    const isJob = timeline(roles, Date.UTC(2026, 10, 17)).some((f) => f.key === `two-current:100:${x.id}`);
    expect([x.title, x.standing, levelOf(x, roles) === 'role']).toEqual([x.title, x.standing, isJob]);
  }
});

test('a row with a title is a role exactly when LinkedIn compares it as a job', () => {
  const found = [{ company: 'Nowhere Inc', title: 'Ghost', start: '2001-01', end: '2002-01', location: '' }];
  for (const x of CANDIDATES.filter((c) => c.title !== '')) {
    const roles = [PARENT, x];
    const compared = diffPositions(found, roles).some((d) => d.key === `linkedin:absent:${x.id}`);
    expect([x.standing, x.part_of, levelOf(x, roles) === 'role']).toEqual([x.standing, x.part_of, compared]);
  }
});

test('each level as the plan names it: filed under a role, personal, nobody placed, a role', () => {
  const roles = [PARENT];
  expect(levelOf(row(1, { part_of: 101 }), roles)).toBe('project');
  expect(levelOf(row(2, { standing: 'personal' }), roles)).toBe('side');
  expect(levelOf(row(3, {}), roles)).toBe('unplaced');
  expect(levelOf(row(4, { standing: 'own' }), roles)).toBe('role');
  expect(levelOf(row(5, { title: 'Engineer' }), roles)).toBe('role');
  // Filed under a role that is no longer there: the row is judged on its own.
  expect(levelOf(row(6, { title: 'Engineer', part_of: 99 }), roles)).toBe('role');
});

test('references come from the id, padded as DESIGN.md writes them', () => {
  expect([roleRef(7), roleRef(12), projectRef(3), projectRef(1042), factRef(142), factRef(5)]).toEqual(['R-07', 'R-12', 'P-003', 'P-1042', 'F-0142', 'F-0005']);
});

test('employment type is a view of standing and label, and is stored back the same way', () => {
  expect(employmentOf({ standing: 'employer', label: '' })).toBe('employee');
  expect(employmentOf({ standing: 'employer', label: 'Part-time' })).toBe('part-time');
  expect(employmentOf({ standing: 'employer', label: 'Contract' })).toBe('contract');
  expect(employmentOf({ standing: 'contract', label: '' })).toBe('contract');
  expect(employmentOf({ standing: 'own', label: '' })).toBe('own');
  expect(employmentOf({ standing: '', label: '' })).toBe('');
  for (const e of ['employee', 'part-time', 'contract', 'own', ''] as const) expect(employmentOf(employmentFields(e, 'employer'))).toBe(e);
  expect(employmentFields('contract', 'employer')).toEqual({ standing: 'contract', label: '' });
});

test('the tree puts each fact in its place: a project of its role, Day to day, a carried project, a side project, General', () => {
  const rows = [
    row(1, { company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', standing: 'employer' }),
    row(2, { company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02', standing: 'employer' }),
    row(3, { company: 'harborlight/dispatch', start: '2021-06', part_of: 1 }),
    row(4, { company: 'lantern-notes', standing: 'personal', start: '2022-05' }),
    row(5, { company: 'avery/sketchbook', start: '2019-02' }),
    row(6, { company: 'Fernway', title: 'Head of Platform', start: '' }),
  ];
  const p = (id: number, more: Partial<ProjectRow>): ProjectRow => ({ id, role_id: null, via_role: null, title: '', start: '', end: '', lives: '', context: '', action: '', result: '', learning: '', ...more });
  const projects = [p(1, { via_role: 3 }), p(2, { via_role: 4, lives: 'A code repository' }), p(3, { via_role: 5 }), p(4, { role_id: 1, title: 'Cut cloud spend by a third', start: '2024-01', result: 'Spend fell 31%.' }), p(5, { role_id: 1, title: 'Wrote the levels guide' })];
  const f = (id: number, role_id: number | null, project_id: number | null = null) => ({ id, role_id, project_id, text: `Fact ${id}.`, metric: '', kind: 'accomplishment' });
  const t = tree(rows, projects, [f(1, 1), f(2, 1, 4), f(3, 3), f(4, 4), f(5, 5), f(6, null), f(7, 2, 4), f(8, 99)]);
  // A role with no dates yet first, then newest first.
  expect(t.roles.map((r) => r.ref)).toEqual(['R-06', 'R-01', 'R-02']);
  // In a role: dated projects newest first, one with no dates last; then side projects; then the unplaced.
  expect(t.projects.map((x) => [x.ref, x.place, x.roleId, x.title, x.carried])).toEqual([
    ['P-004', 'role', '1', 'Cut cloud spend by a third', false], ['P-001', 'role', '1', 'harborlight/dispatch', true], ['P-005', 'role', '1', 'Wrote the levels guide', false],
    ['P-002', 'side', '', 'lantern-notes', true], ['P-003', 'unplaced', '', 'avery/sketchbook', true]]);
  expect(t.projects.find((x) => x.id === '2')!.lives).toBe('A code repository');
  // A fact names its project only when that project is in the fact's own role (fact 7 is filed under role 2).
  expect(t.facts.map((x) => [x.ref, x.roleId, x.projectId])).toEqual([
    ['F-0001', '1', ''], ['F-0002', '1', '4'], ['F-0003', '1', '1'], ['F-0004', '', '2'], ['F-0005', '', '3'], ['F-0006', '', ''], ['F-0007', '2', ''], ['F-0008', '', '']]);
});

test('a carried row that became a role shows as that role, and its old project is not shown', () => {
  const rows = [row(1, { company: 'Tidewater', title: 'Maintainer', standing: 'own', start: '2015-02' })];
  const t = tree(rows, [{ id: 1, role_id: null, via_role: 1, title: '', start: '', end: '', lives: '', context: '', action: '', result: '', learning: '' }], [{ id: 1, role_id: 1, project_id: null, text: 'Built it.', metric: '', kind: 'project' }]);
  expect(t.roles.map((r) => r.ref)).toEqual(['R-01']);
  expect(t.projects).toEqual([]);
  expect(t.facts.map((x) => [x.roleId, x.projectId])).toEqual([['1', '']]);
});
