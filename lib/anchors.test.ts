// `bun test lib`: where each flag belongs on the resume (rule 7, notes in the margin): `at` on a flag names the Summary,
// a bullet, a role's heading or the whole resume, for every kind that can be placed without a guess. A kind that cannot
// be placed has no `at`. The scratch database of an invented person; no model.
import { beforeEach, expect, test } from 'bun:test';
import { db, role, seed } from './scratch.ts';
import { flagContext, flags, type Anchor, type Flag } from './checks.ts';

const RESUME = `# Avery Lindqvist
line

## Summary
Avery is an engineer with 14 years in logistics. She built a dispatch console for 640 users across 12 depots. It runs every day. It is fast.

## Experience
### VP of Engineering, Harborlight Systems
Mar 2021 – Present
- Built the dispatch console.
- Cut a run for [number] drivers.

### Engineer, Globex
Jan 2022 – Present
- Build the routing service.

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021

### Support Lead, Tessellate Freight
May 2010 – Aug 2012
- Led the support desk.
- Answered tickets.

## Awards
Won a prize, 2018 – 2019

## Skills
Go`;

beforeEach(() => { seed(); role({ id: 4, company: 'Globex', title: 'Engineer', start: '2022-01' }); });
const by = (fs: Flag[], kind: string) => fs.filter((f) => f.kind === kind);
const H = { where: 'role', entry: 'harborlight systems', text: 'VP of Engineering, Harborlight Systems' } as const;

test('each kind that can be placed is placed: the summary, a bullet, a role’s heading or the whole resume', () => {
  const fs = flags(RESUME, 2, { skim: { conclusion: '', questions: [], top: [], revisions: 0, model: 'haiku', saw: '', open: [] } }, Date.UTC(2026, 10, 18), flagContext());
  const at = (kind: string) => by(fs, kind).map((f) => f.at);
  expect(at('facts')).toEqual([[H], [{ where: 'resume', text: 'Won a prize, 2018 – 2019' }]]);
  expect(at('zero-bullets')).toEqual([[{ where: 'role', entry: 'quillfeather labs', text: 'Senior Engineer, Quillfeather Labs' }]]);
  expect(at('old-role')).toEqual([[{ where: 'role', entry: 'tessellate freight', text: 'Support Lead, Tessellate Freight' }]]);
  for (const k of ['summary-long', 'summary-person', 'summary-metric']) expect([k, at(k)]).toEqual([k, [[{ where: 'summary' }]]]);
  expect(at('tense')).toEqual([[{ where: 'bullet', entry: 'harborlight systems', text: 'Built the dispatch console.' }]]);
  expect(at('number-mark')).toEqual([[{ where: 'bullet', entry: 'harborlight systems', text: 'Cut a run for [number] drivers.' }]]);
  // Each result left out is placed on the heading of its job, with the fact it comes from.
  const dropped = by(fs, 'metrics-dropped')[0];
  const entry: Record<number, string> = { 1: 'harborlight systems', 2: 'quillfeather labs', 3: 'tessellate freight' };
  expect(dropped.items!.length).toBeGreaterThan(1);
  expect(dropped.at!.map((a: Anchor) => [a.where, a.entry, a.item, a.facts])).toEqual(dropped.items!.map((item) => {
    const f = db.query('SELECT id, role_id FROM facts WHERE metric = ?').get(item) as { id: number; role_id: number };
    return ['role', entry[f.role_id], item, [f.id]];
  }));
  // Two current jobs: the timeline finding is placed on both headings.
  expect(at('timeline')).toEqual([[H, { where: 'role', entry: 'globex', text: 'Engineer, Globex' }]]);
  // What cannot be placed without a guess stays whole.
  for (const k of ['headings', 'skills-unconfirmed', 'skim-stale']) expect([k, by(fs, k).map((f) => f.at)]).toEqual([k, [undefined]]);
});

test('an opening the skim finds misleading is placed on the summary; its other findings stay whole', () => {
  const md = '# Avery Lindqvist\nline\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console.';
  const saw = 'Name: Avery Lindqvist\nSummary: Engineer.\nFirst role: Director of Engineering, Harborlight Systems\nDates: Mar 2021 – Present\n- Build the dispatch console.';
  const fs = flags(md, 2, { skim: { conclusion: '', questions: ['Why?'], top: [{ requirement: 'Go', answered: false, note: '' }], revisions: 0, model: 'haiku', saw, open: ['The opening misleads: it says engineer.', 'Something else.'] } });
  expect(fs.filter((f) => f.kind.startsWith('skim') || f.kind === 'top-requirement').map((f) => [f.kind, f.at])).toEqual([
    ['top-requirement', undefined], ['skim-open', [{ where: 'summary' }]], ['skim-open', undefined], ['skim-question', undefined]]);
});

test('a finding of the links’ check left after the skim’s rewrites is shown once, not again inside the skim’s list', () => {
  const md = '# Avery Lindqvist\nline\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console.';
  const saw = 'Name: Avery Lindqvist\nSummary: Engineer.\nFirst role: Director of Engineering, Harborlight Systems\nDates: Mar 2021 – Present\n- Build the dispatch console.';
  const links = { v: 1 as const, lines: [{ where: 'summary' as const, entry: '', text: 'Engineer.', facts: [1], edited: 0 }] };
  const said = '“Build the dispatch console.” names no fact of your record that it draws on.';
  const fs = flags(md, 2, { links, skim: { conclusion: '', questions: [], top: [], revisions: 2, model: 'haiku', saw, open: [said, 'Something else.'] } });
  expect(fs.filter((f) => f.text === said).map((f) => f.kind)).toEqual(['unlinked']);
  expect(fs.filter((f) => f.kind === 'skim-open').map((f) => f.text)).toEqual(['Something else.']);
});
