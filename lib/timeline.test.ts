// `bun test lib`: the timeline findings of rule 4, each one and each case that must not be one.
// The roles are invented. Nothing opens a database.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { timeline } from './timeline.ts';

const NOW = new Date(2026, 10, 16).getTime();
const role = (id: number, company: string, start: string, end: string, more: Partial<RoleRow> = {}): RoleRow =>
  ({ id, company, title: 'Engineer', start, end, location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });
const kinds = (roles: RoleRow[]) => timeline(roles, NOW).map((f) => f.kind);

test('two roles that both say Present are a finding, with the choices the rule names', () => {
  const found = timeline([role(1, 'Harborlight Systems', '2021-03', ''), role(2, 'Quillfeather Labs', '2023-06', '')], NOW);
  expect(found.map((f) => f.key)).toEqual(['two-current:1:2']);
  expect(found[0].question!.choices.length).toBe(3);
  expect(found[0].question!.actions).toEqual([{ role: 1, field: 'end' }, { role: 2, field: 'end' }, { role: 2, field: 'note' }]);
  expect(found[0].question!.text).toContain('Which is right?');
});

test('a context note or an end date settles two current roles', () => {
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', ''), role(2, 'Quillfeather Labs', '2023-06', '', { note: 'My own studio, run on weekends.' })])).toEqual([]);
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', ''), role(2, 'Quillfeather Labs', '2018-06', '2021-03')])).toEqual([]);
});

test('an overlap longer than one month is a finding, and one month is not', () => {
  const two = timeline([role(1, 'Harborlight Systems', '2021-03', '2023-01'), role(2, 'Quillfeather Labs', '2022-08', '2024-02')], NOW);
  expect(two.map((f) => f.kind)).toEqual(['overlap']);
  expect(two[0].text).toContain('overlap by 5 months');
  expect(two[0].question!.choices.join(' ')).toMatch(/contract work.*part-time.*transition.*dates are wrong/);
  expect(two[0].question!.actions[0]).toEqual({ role: 1, field: 'label', value: 'Contract' });
  // Ending in April and starting in March is one month of handover.
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', '2023-04'), role(2, 'Quillfeather Labs', '2023-03', '2024-02')])).toEqual([]);
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', '2023-05'), role(2, 'Quillfeather Labs', '2023-03', '2024-02')])).toEqual(['overlap']);
  // A current job overlapped by one that started and ended inside it.
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', ''), role(2, 'Quillfeather Labs', '2022-01', '2022-09')])).toEqual(['overlap']);
});

test('a label, a note, contract work, a personal project and part_of are not overlaps', () => {
  const a = role(1, 'Harborlight Systems', '2021-03', '2023-01');
  expect(kinds([a, role(2, 'Quillfeather Labs', '2022-08', '2024-02', { label: 'Part-time' })])).toEqual([]);
  expect(kinds([a, role(2, 'Quillfeather Labs', '2022-08', '2024-02', { note: 'Handover agreed with both.' })])).toEqual([]);
  expect(kinds([a, role(2, 'Quillfeather Labs', '2022-08', '2024-02', { standing: 'contract' })])).toEqual([]);
  expect(kinds([a, role(2, 'Lantern Notes', '2022-08', '2024-02', { standing: 'personal' })])).toEqual([]);
  // A project group filed under the employer is that employer's work, whatever its dates. So is a titled role filed under it.
  expect(kinds([a, role(2, 'harborlight/dispatch', '2021-06', '2022-12', { title: '', part_of: 1, standing: '' })])).toEqual([]);
  expect(kinds([a, role(2, 'Harborlight Labs', '2021-06', '2022-12', { part_of: 1 })])).toEqual([]);
  expect(kinds([role(1, 'Harborlight Systems', '2021-03', ''), role(2, 'Harborlight Labs', '2022-06', '', { part_of: 1 })])).toEqual([]);
  // A repository's project group with no title and no class is not a job.
  expect(kinds([a, role(2, 'some/repo', '2021-06', '2022-12', { title: '', standing: '' })])).toEqual([]);
});

test('the same employer in several rows is one entry, not an overlap', () => {
  const found = timeline([role(1, 'Harborlight Systems', '2019-01', '2021-06', { title: 'Engineer' }), role(2, 'Harborlight Systems, Inc.', '2021-04', '', { title: 'Staff Engineer' })], NOW);
  expect(found.map((f) => f.kind)).toEqual(['repeat-employer']);
  expect(found[0].roles).toEqual([2, 1]);
  expect(found[0].question).toBeUndefined();
});

test('three stints under twelve months in a row are a finding, two are not, and a label settles them', () => {
  const stints = [role(1, 'Tessellate Freight', '2015-01', '2015-09'), role(2, 'Marrow & Pine Studio', '2015-10', '2016-04'), role(3, 'Quillfeather Labs', '2016-05', '2017-02')];
  const found = timeline(stints, NOW);
  expect(found.map((f) => f.kind)).toEqual(['short-stints']);
  expect(found[0].roles).toEqual([1, 2, 3]);
  expect(found[0].question!.choices).toEqual(['They were contract work: label each one Contract', 'Group them into one line on the resume', 'Leave them as they are']);
  expect(found[0].question!.actions[0]).toEqual({ role: [1, 2, 3], field: 'label', value: 'Contract' });
  expect(kinds(stints.slice(0, 2))).toEqual([]);
  // A long job between them breaks the run.
  expect(kinds([stints[0], role(4, 'Harborlight Systems', '2015-10', '2018-01'), { ...stints[2], start: '2018-02', end: '2018-10' }, role(5, 'Lantern Notes Ltd', '2018-11', '2019-03')])).toEqual([]);
  expect(kinds(stints.map((r) => ({ ...r, label: 'Contract' })))).toEqual([]);
  // Twelve months exactly is not short.
  expect(kinds([stints[0], stints[1], { ...stints[2], end: '2017-04' }])).toEqual([]);
  // A current job of a few months is not a stint that ended.
  expect(kinds([stints[0], stints[1], { ...stints[2], end: '' }])).toEqual([]);
});

test('with a date that is only a year, the overlap is said as "up to", never as a firm count', () => {
  const firm = timeline([role(1, 'Harborlight Systems', '2021-03', '2023-01'), role(2, 'Quillfeather Labs', '2022-08', '2024-02')], NOW)[0];
  expect(firm.question!.text).toContain('overlap by 5 months.');
  for (const [a, b] of [[role(1, 'Harborlight Systems', '2019', '2022'), role(2, 'Quillfeather Labs', '2021', '2024')], [role(1, 'Harborlight Systems', '2019-03', '2022'), role(2, 'Quillfeather Labs', '2021-06', '2024-01')]]) {
    const found = timeline([a, b], NOW);
    expect(found.map((f) => f.kind)).toEqual(['overlap']);
    expect(found[0].question!.text).toMatch(/overlap by up to \d+ months \(some of these dates are a year with no month\)\. Was one of them/);
    expect(found[0].text).toMatch(/overlap by up to \d+ months/);
    expect(found[0].question!.text).not.toMatch(/overlap by \d/);
  }
  expect(timeline([role(1, 'Harborlight Systems', '2019', '2022'), role(2, 'Quillfeather Labs', '2021', '2024')], NOW)[0].question!.text).toContain('by up to 23 months');
});
