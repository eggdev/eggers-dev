// `bun test lib`: the facts check of rules 5, 9 and 10, and the entries of rule 4. A resume's titles, employers
// and dates are compared with the bank's roles; a resume a model wrote is repaired where the match is certain;
// the same findings on the person's own edit are only reported. The roles and resumes are invented.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { canonical, checkEntries, collapseEmpty, employers, repairEntries } from './entries.ts';
import { parseResume } from './resume.ts';

const role = (id: number, title: string, company: string, start: string, end: string, more: Partial<RoleRow> = {}): RoleRow =>
  ({ id, company, title, start, end, location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });
const ROLES = [
  role(1, 'Director of Engineering', 'Harborlight Systems', '2021-03', '', { location: 'Remote' }),
  role(2, 'Staff Engineer', 'Quillfeather Labs', '2019-01', '2021-02'),
  role(3, 'Senior Engineer', 'Quillfeather Labs', '2016-01', '2018-12'),
  role(4, 'Support Lead', 'Tessellate Freight', '2010-05', '2012-08'),
];
const resume = (h1: string, d1: string, h2 = '### Staff Engineer, Quillfeather Labs', d2 = 'Jan 2019 – Feb 2021\nPreviously Senior Engineer, Jan 2016 – Dec 2018') => `# Avery Lindqvist
avery@lindqvist.example

## Summary
Engineer.

## Experience
${h1}
${d1}
- Build the dispatch console.

${h2}
${d2}
- Rebuilt the quoting API.

## Earlier experience
Support Lead, Tessellate Freight (2010 – 2012)

## Skills
Go
`;
const TRUE = resume('### Director of Engineering, Harborlight Systems', 'Mar 2021 – Present · Remote');

test('repeated employers are one entry with each title and date range', () => {
  const groups = employers(ROLES);
  expect(groups.map((g) => [g.company, g.rows.map((r) => r.id)])).toEqual([['Harborlight Systems', [1]], ['Quillfeather Labs', [2, 3]], ['Tessellate Freight', [4]]]);
  expect(canonical(groups[1])).toEqual({ heading: 'Staff Engineer, Quillfeather Labs', dates: 'Jan 2019 – Feb 2021', previously: ['Previously Senior Engineer, Jan 2016 – Dec 2018'], note: '', earlier: 'Staff Engineer, Quillfeather Labs (2016 – 2021)' });
  // The same title held twice is two date ranges on one line.
  const twice = employers([role(1, 'Engineer', 'Harborlight Systems', '2022-01', ''), role(2, 'Engineer', 'Harborlight Systems, Inc.', '2017-03', '2019-12')]);
  expect(twice.length).toBe(1);
  expect(canonical(twice[0]).dates).toBe('Jan 2022 – Present; Mar 2017 – Dec 2019');
});

test('labels, ownership and the note are printed with the entry', () => {
  const c = (more: Partial<RoleRow>, title = 'Engineer') => canonical(employers([role(1, title, 'Lantern Notes', '2022-01', '2023-06', more)])[0]);
  expect(c({ label: 'Part-time', location: 'Duluth, MN' }).dates).toBe('Jan 2022 – Jun 2023 · Part-time · Duluth, MN');
  expect(c({ standing: 'contract' }).dates).toBe('Jan 2022 – Jun 2023 · Contract');
  expect(c({ standing: 'own' }).dates).toBe('Jan 2022 – Jun 2023 · Own company');
  expect(c({ standing: 'own' }, 'Founder').dates).toBe('Jan 2022 – Jun 2023');
  expect(c({ standing: 'personal' }, '')).toMatchObject({ heading: 'Lantern Notes', dates: 'Jan 2022 – Jun 2023 · Personal project' });
  expect(c({ note: 'Ran beside the Harborlight job, evenings only.' }).note).toBe('Ran beside the Harborlight job, evenings only.');
});

test('a resume that matches the bank has no findings, and repairing it changes nothing', () => {
  expect(checkEntries(TRUE, ROLES)).toEqual([]);
  expect(repairEntries(TRUE, ROLES)).toEqual({ resume: TRUE, repaired: [], unresolved: [] });
});

test('a changed title is found, and put back in a resume a model wrote', () => {
  const changed = resume('### VP of Engineering, Harborlight Systems', 'Mar 2021 – Present · Remote');
  const found = checkEntries(changed, ROLES);
  expect(found.map((f) => [f.kind, f.was, f.is, f.fixable])).toEqual([['title', 'VP of Engineering', 'Director of Engineering', true]]);
  expect(found[0].text).toContain('A background check verifies titles.');
  const fixed = repairEntries(changed, ROLES);
  expect(fixed.resume).toBe(TRUE);
  expect(fixed.repaired.length).toBe(1);
  expect(fixed.unresolved).toEqual([]);
});

test('a changed date is found, and put back', () => {
  const changed = resume('### Director of Engineering, Harborlight Systems', 'Jan 2020 – Present · Remote');
  expect(checkEntries(changed, ROLES).map((f) => [f.kind, f.was, f.is])).toEqual([['dates', 'Jan 2020 – Present', 'Mar 2021 – Present']]);
  expect(repairEntries(changed, ROLES).resume).toBe(TRUE);
  // A range of a merged employer left out, or stretched into one, is a changed date too.
  const stretched = resume('### Director of Engineering, Harborlight Systems', 'Mar 2021 – Present · Remote', '### Staff Engineer, Quillfeather Labs', 'Jan 2016 – Feb 2021');
  expect(checkEntries(stretched, ROLES).map((f) => f.kind)).toEqual(['dates']);
  expect(repairEntries(stretched, ROLES).resume).toBe(TRUE);
  // A year alone agrees with any month of it.
  expect(checkEntries(resume('### Director of Engineering, Harborlight Systems', '2021 – Present'), ROLES)).toEqual([]);
});

test('a changed employer is put back when the title and dates point at one job only', () => {
  const changed = resume('### Director of Engineering, Harbourlite Group', 'Mar 2021 – Present · Remote');
  expect(checkEntries(changed, ROLES).map((f) => [f.kind, f.was, f.is])).toEqual([['employer', 'Harbourlite Group', 'Harborlight Systems']]);
  expect(repairEntries(changed, ROLES).resume).toBe(TRUE);
});

test('an entry the bank does not have, and an employer split in two, are not repaired', () => {
  const invented = resume('### Chief Architect, Nimbus Yard', 'Mar 2015 – Present');
  const got = repairEntries(invented, ROLES);
  expect(got.unresolved.map((f) => f.kind)).toEqual(['unknown']);
  expect(got.resume).toContain('### Chief Architect, Nimbus Yard');
  const split = resume('### Staff Engineer, Quillfeather Labs', 'Jan 2019 – Feb 2021', '### Senior Engineer, Quillfeather Labs', 'Jan 2016 – Dec 2018');
  expect(repairEntries(split, ROLES).unresolved.map((f) => f.kind)).toEqual(['split']);
});

test('the Earlier experience line is checked and put back from the bank too', () => {
  const changed = TRUE.replace('Support Lead, Tessellate Freight (2010 – 2012)', 'Head of Support, Tessellate Freight (2009 – 2013); Clerk, Nimbus Yard (2008)');
  expect(checkEntries(changed, ROLES).map((f) => f.kind)).toEqual(['title', 'dates', 'unknown']);
  const fixed = repairEntries(changed, ROLES);
  expect(fixed.resume).toContain('Support Lead, Tessellate Freight (2010 – 2012); Clerk, Nimbus Yard (2008)');
  expect(fixed.unresolved.length).toBe(1);
});

test('the person\'s note is printed under the dates when the writer left it out', () => {
  const roles = ROLES.map((r) => (r.id === 1 ? { ...r, note: 'Also runs Lantern Notes, a side business, on weekends.' } : r));
  const fixed = repairEntries(TRUE, roles).resume.split('\n');
  expect(fixed[fixed.indexOf('### Director of Engineering, Harborlight Systems') + 2]).toBe('Also runs Lantern Notes, a side business, on weekends.');
  expect(repairEntries(fixed.join('\n'), roles).resume).toBe(fixed.join('\n'));
});

test('an entry with no bullets goes to the Earlier experience line', () => {
  const bare = TRUE.replace('- Rebuilt the quoting API.\n', '');
  const got = collapseEmpty(bare, ROLES), r = parseResume(got);
  expect(r.experience.map((e) => e.company)).toEqual(['Harborlight Systems']);
  expect(r.earlier.map((e) => e.text)).toEqual(['Support Lead, Tessellate Freight (2010 – 2012)', 'Staff Engineer, Quillfeather Labs (2016 – 2021)']);
  expect(got).not.toContain('Previously Senior Engineer');
  // With no such section yet, one is made after Experience.
  const none = bare.replace('## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012)\n\n', '');
  const made = parseResume(collapseEmpty(none, ROLES));
  expect(made.sections).toEqual(['Summary', 'Experience', 'Earlier experience', 'Skills']);
  expect(made.earlier.map((e) => e.text)).toEqual(['Staff Engineer, Quillfeather Labs (2016 – 2021)']);
  expect(collapseEmpty(TRUE, ROLES)).toBe(TRUE);
});
