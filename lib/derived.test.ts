// `bun test lib`: "How you work" (lib/derived.ts): each rule shows its line only at or above its minimum, says what it
// was counted from and what is behind it; a verdict is kept, an unchanged verdict writes nothing, and one can be taken
// back. Everything is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, seed } from './scratch.ts';
import { howYouWork, judge, shownLines, verdicts, type DerivedInput } from './derived.ts';

beforeEach(() => seed());
const fact = (id: number, roleId: string, text: string, more: Partial<DerivedInput['facts'][number]> = {}) => ({ id: String(id), roleId, projectId: '', text, metric: '', skills: '', ...more });
const roles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
const none: DerivedInput = { roles: [], projects: [], facts: [], metrics: [], skills: [] };
const keys = (x: DerivedInput) => howYouWork(x).map((l) => l.key);

test('results: the two commonest kinds, only from 8 measured results and when they are more than half', () => {
  const metrics = (kinds: string[]) => kinds.map((k, i) => ({ fact: String(i + 1), kind: k as never }));
  expect(keys({ ...none, metrics: metrics(['latency', 'latency', 'latency', 'time saved', 'time saved', 'users', 'revenue']) })).toEqual([]);
  const eight = { ...none, metrics: metrics(['latency', 'latency', 'latency', 'time saved', 'time saved', 'users', 'revenue', 'adoption']) };
  expect(howYouWork(eight)[0]).toEqual({ key: 'results:latency+time saved', text: 'Most of your measured results are about latency and time saved: 5 of 8.',
    basis: 'Counted from the 8 measured results in your record.', items: ['fact:1', 'fact:2', 'fact:3', 'fact:4', 'fact:5'] });
  // Exactly half is not most.
  expect(keys({ ...none, metrics: metrics(['latency', 'latency', 'time saved', 'time saved', 'users', 'revenue', 'adoption', 'team size']) })).toEqual([]);
  // Spread evenly over the six kinds, the two commonest are a third: not most.
  expect(keys({ ...none, metrics: metrics(['latency', 'time saved', 'users', 'revenue', 'adoption', 'team size', 'latency', 'time saved', 'users', 'revenue', 'adoption', 'team size']) })).toEqual([]);
});

test('led: a team in 2 of at least 3 roles', () => {
  const two = { ...none, roles: roles(3), facts: [fact(1, '1', 'Hired 7 engineers.'), fact(2, '2', 'Managed a team of 9.'), fact(3, '3', 'Wrote the billing export.')] };
  expect(howYouWork(two)).toEqual([{ key: 'led', text: 'Your record shows you managing, hiring or growing a team in 2 of 3 roles.', basis: 'Counted from 2 facts about managing, hiring or the size of a team.', items: ['fact:1', 'fact:2'] }]);
  expect(keys({ ...two, roles: roles(2) })).toEqual([]);
  expect(keys({ ...two, facts: two.facts.slice(1) })).toEqual([]);
});

test('skill: in 3 roles or more; never a skill marked not confident or one that is not a tool, language or platform', () => {
  const facts = [fact(1, '1', 'A.', { skills: 'Go, Kafka' }), fact(2, '2', 'B.', { skills: 'go' }), fact(3, '3', 'C.', { skills: 'Go, Kafka' }), fact(4, '3', 'D.', { skills: 'Kafka' })];
  const x = { ...none, roles: roles(4), facts, skills: [{ name: 'Go', kind: 'language', mark: '' }, { name: 'Kafka', kind: 'platform', mark: 'not-confident' }] };
  expect(howYouWork(x)).toEqual([{ key: 'skill:go', text: 'Go runs through 3 of your 4 roles.', basis: 'Counted from the skills your facts name.', items: ['role:1', 'role:2', 'role:3'] }]);
  expect(keys({ ...x, skills: [{ name: 'Go', kind: 'other', mark: '' }] })).toEqual([]);
});

test('measured: from 5 projects; learned: from 4 projects that say what was learned, with a phrase shared by 2', () => {
  const projects = ['Move one team at a time.', 'Hand it over early, and move one team at a time.', 'Dates hold when scope is cut.', '', 'A weekly number per team did more than any rule.']
    .map((learning, i) => ({ id: String(i + 1), learning }));
  const facts = [fact(1, '1', 'Cut deploys to 9 minutes.', { projectId: '1' }), fact(2, '1', 'Wrote the plan.', { projectId: '2' })];
  const x = { ...none, projects, facts, metrics: [{ fact: '1', kind: 'time saved' as const }] };
  expect(howYouWork(x)).toEqual([
    { key: 'measured', text: '1 of your 5 projects have a measured result.', basis: 'Counted from your 5 projects and the numbers in their facts.', items: ['project:1'] },
    { key: 'learned:one team at a time', text: 'What you say you learned most often: “one team at a time” (2 projects).', basis: 'Read from Learning on 4 projects.', items: ['project:1', 'project:2'] }]);
  expect(keys({ ...x, projects: projects.slice(0, 4) })).toEqual([]);
});

test('three lines are shown; one not true is replaced by the next; a verdict is kept once and can be taken back', () => {
  const lines = [1, 2, 3, 4].map((n) => ({ key: `k${n}`, text: `Line ${n}.`, basis: 'Counted.', items: [] }));
  expect(shownLines(lines, new Map()).map((l) => l.key)).toEqual(['k1', 'k2', 'k3']);
  expect(judge(lines, 'k2', 'rejected', 5)).toBe('');
  expect(judge(lines, 'k1', 'kept', 6)).toBe('');
  expect(shownLines(lines, verdicts()).map((l) => [l.key, l.verdict])).toEqual([['k1', 'kept'], ['k3', ''], ['k4', '']]);
  // The same verdict again writes nothing.
  const changes = (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  expect(judge(lines, 'k1', 'kept', 7)).toBe('');
  expect((db.query('SELECT total_changes() AS n').get() as { n: number }).n).toBe(changes);
  expect(db.query('SELECT key, verdict, text, judged_at FROM derived_lines ORDER BY key').all()).toEqual([{ key: 'k1', verdict: 'kept', text: 'Line 1.', judged_at: 6 }, { key: 'k2', verdict: 'rejected', text: 'Line 2.', judged_at: 5 }]);
  // Undone: the line is back in its place.
  expect(judge(lines, 'k2', '', 8)).toBe('');
  expect(shownLines(lines, verdicts()).map((l) => l.key)).toEqual(['k1', 'k2', 'k3']);
  // A line that no longer holds cannot be judged; a word outside the three is refused.
  expect(judge(lines, 'gone', 'kept', 9)).toBe('That line no longer holds for your record.');
  expect(judge(lines, 'k3', 'maybe', 9)).toBe('Say kept, rejected, or nothing to take a verdict back.');
});

test('led counts only statements about a team: not a migration managed, a promotion, or being hired', () => {
  const x = (texts: string[]) => ({ ...none, roles: roles(texts.length), facts: texts.map((t, i) => fact(i + 1, String(i + 1), t)) });
  expect(keys(x(['Managed the migration of 40 services.', 'Was promoted to senior engineer.', 'Hired as the first support agent.']))).toEqual([]);
  expect(keys(x(['Was hired to rebuild billing.', 'Promoted 4 engineers to senior.', 'Ran the weekly incident review.']))).toEqual([]);
  for (const team of ['Led a support team of 6 through the peak.', 'Managed a team that shipped billing.', 'Managed 12 engineers across two sites.', 'Hired 7 engineers in 12 months.',
    'Mentored 3 junior developers.', 'Mentored engineers new to Go.', 'Had 5 direct reports.', 'Coached 5 managers through their first year.'])
    expect([team, keys(x([team, 'Took over a team of 9.', 'Wrote the plan.']))]).toEqual([team, ['led']]);
});

test('a line said not to be true stays away when a role or a project is added: its key names the finding, not its counts', () => {
  const lines = (n: number) => howYouWork({ ...none, roles: roles(n), facts: [fact(1, '1', 'Hired 7 engineers.'), fact(2, '2', 'Managed a team of 9.')] });
  expect(judge(lines(3), 'led', 'rejected', 1)).toBe('');
  expect(shownLines(lines(4), verdicts())).toEqual([]);
  // Its numbers are counted afresh: the line says 2 of 4 once a fourth role is there.
  expect(lines(4)[0].text).toBe('Your record shows you managing, hiring or growing a team in 2 of 4 roles.');
});
