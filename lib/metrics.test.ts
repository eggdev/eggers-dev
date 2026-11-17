// `bun test lib`: the metrics inventory of rule 3. Which results are impact metrics and which are incidental
// numbers, and what a resume holds and drops against its master. The facts are invented. No database.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { inventory, kept, metricOf, numbersIn, shows } from './metrics.ts';
import { parseResume } from './resume.ts';

const kind = (metric: string) => metricOf({ id: 1, role_id: 1, metric })?.kind;

test('an impact metric is taken in under one of the six kinds', () => {
  expect(kind('640 users across 12 depots')).toBe('users');
  expect(kind('500+ customers')).toBe('users');
  expect(kind('$1.2M in new annual revenue')).toBe('revenue');
  expect(kind('saved $40,000 a year in hosting costs')).toBe('revenue');
  expect(kind('saved $2,000 per month')).toBe('revenue');
  expect(kind('p95 latency 900 ms to 210 ms')).toBe('latency');
  expect(kind('page load time from 4.2 s to 1.1 s')).toBe('latency');
  expect(kind('adopted by 9 departments')).toBe('adoption');
  expect(kind('team of 6 people')).toBe('team size');
  expect(kind('led five engineers')).toBe('team size');
  expect(kind('from 6 hours to 40 minutes')).toBe('time saved');
  expect(kind('saves each dispatcher 3 hours per week')).toBe('time saved');
});

test('an incidental number, or one whose kind the words do not say, is left out', () => {
  for (const m of ['212 tests', '98% test coverage', '14 files and 3 endpoints', 'launched March 3, 2024', 'merged in Q2 2023', 'shipped 12 days ago', 'Python 3.12', 'saved about $100 a month',
    '$300 in credits', '41 pull requests', '3,400 lines of code', '$1.2M', '37', 'about 40', '30% fewer errors', 'revenue covers costs', '']) expect(kind(m)).toBeUndefined();
  // A metric that also counts tests keeps its impact number and loses the other.
  expect(metricOf({ id: 1, role_id: 1, metric: '640 users, 212 tests' })).toMatchObject({ kind: 'users', tokens: ['640'] });
  // A year is a date, not a result.
  expect(metricOf({ id: 1, role_id: 1, metric: '640 users by 2024' })!.tokens).toEqual(['640']);
});

test('a number is the same number however it is written', () => {
  expect(numbersIn('12,000 users, $1.2 million, 40 percent, five engineers, 3x')).toEqual(['12000', '$1.2m', '40%', '5', '3x']);
  const m = metricOf({ id: 1, role_id: 1, metric: 'p95 latency 900 ms to 210 ms' })!;
  expect(shows('Rebuilt the API in Go, taking p95 latency to 210 ms.', m)).toBe(true);
  expect(shows('Rebuilt the API in Go 2, on port 9000.', m)).toBe(false);
  // A bare small number counts only when the metric has no surer one.
  expect(shows('Ran 12 workshops.', metricOf({ id: 2, role_id: 1, metric: '640 users across 12 depots' })!)).toBe(true);
  expect(shows('Hired 6 contractors.', metricOf({ id: 3, role_id: 1, metric: 'team of 6 people' })!)).toBe(true);
});

const role = (id: number, title: string, company: string, more: Partial<RoleRow> = {}): RoleRow => ({ id, company, title, start: '2020-01', end: '', location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });
const ROLES = [role(1, 'Director of Engineering', 'Harborlight Systems'), role(2, 'Senior Engineer', 'Quillfeather Labs', { end: '2019-12', start: '2016-01' }), role(3, '', 'harborlight/dispatch', { part_of: 1 })];
const FACTS = [{ id: 1, role_id: 1, metric: '640 users across 12 depots' }, { id: 2, role_id: 1, metric: 'from 6 hours to 40 minutes' }, { id: 3, role_id: 1, metric: '212 tests' },
  { id: 4, role_id: 2, metric: 'p95 latency 900 ms to 210 ms' }, { id: 5, role_id: 3, metric: 'adopted by 9 departments' }, { id: 6, role_id: null, metric: '3,000 users' }];

test('the master is the inventory of the roles shown with bullets, and what is not held is dropped', () => {
  const metrics = inventory(FACTS);
  expect(metrics.map((m) => m.fact)).toEqual([1, 2, 4, 5, 6]);
  const r = parseResume(`# Avery Lindqvist\n\n## Summary\nEngineer. Cut p95 latency to 210 ms.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nJan 2020 – Present\n- Build the dispatch console for 640 users.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Dec 2019\n- Rebuilt the quoting API in Go.\n`);
  const k = kept(r, metrics, ROLES);
  // The project filed under Harborlight counts as Harborlight's. The general fact belongs to no role shown.
  expect(k.master.map((m) => m.fact)).toEqual([1, 2, 5, 4]);
  expect(k.held.map((m) => m.fact)).toEqual([1, 4]);
  expect(k.dropped.map((m) => m.text)).toEqual(['from 6 hours to 40 minutes', 'adopted by 9 departments']);
  // The latency result is in the summary and not in its own role's bullets (rule 2).
  expect(k.summaryOnly.map((m) => m.fact)).toEqual([4]);
});

test('a role shown without bullets, or not shown, adds nothing to the master', () => {
  const r = parseResume(`# Avery Lindqvist\n\n## Experience\n### Director of Engineering, Harborlight Systems\nJan 2020 – Present\n- Build the console for 640 users across 12 depots, cutting a run from 6 hours to 40 minutes, now adopted by 9 departments.\n\n## Earlier experience\nSenior Engineer, Quillfeather Labs (2016 – 2019)\n`);
  const k = kept(r, inventory(FACTS), ROLES);
  expect(k.master.map((m) => m.fact)).toEqual([1, 2, 5]);
  expect(k.dropped).toEqual([]);
});

test('a percentile name and a ratio are not numbers of a result', () => {
  const latency = metricOf({ id: 1, role_id: 1, metric: 'p95 latency 900 ms to 210 ms' })!;
  expect(latency).toMatchObject({ kind: 'latency', tokens: ['900', '210'] });
  expect(numbersIn('p95 and p999 on call 24/7 with 3/4 of the team')).toEqual([]);
  // A bullet that only names the percentile, or says "24/7", does not hold the metric.
  expect(shows('Tuned the p95 of the quoting API, on call 24/7.', latency)).toBe(false);
  expect(shows('Took p95 latency to 210 ms.', latency)).toBe(true);
  expect(kind('p99 from 1.4 s to 300 ms')).toBe('latency');
  const uptime = metricOf({ id: 2, role_id: 1, metric: 'supported 95 customers 24/7' })!;
  expect(uptime).toMatchObject({ kind: 'users', tokens: ['95'] });
  expect(shows('Ran the desk 24/7 and tuned the p95.', uptime)).toBe(false);
});

test('a share of money saved is a money metric, and a bare percentage is still left out', () => {
  expect(metricOf({ id: 1, role_id: 1, metric: 'cut cloud costs by 30%' })).toMatchObject({ kind: 'revenue', tokens: ['30%'] });
  expect(kind('reduced hosting spend 45 percent')).toBe('revenue');
  expect(kind('grew revenue 20%')).toBe('revenue');
  for (const m of ['30%', 'improved by 30%', '30% fewer errors', 'saved 30%', '98% test coverage']) expect(kind(m)).toBeUndefined();
});
