// `bun test lib`: defects an independent review found in the resume rules, each kept as a test.
// - An invented job is caught wherever it is written, not only as a "###" heading under Experience.
// - A repair keeps the text whole when the Earlier experience section sits above the entries.
// - Text with Windows line endings reads the same as text with plain ones.
// The roles and resumes are invented. Nothing here opens a database or asks a model.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { checkEntries, collapseEmpty, repairEntries } from './entries.ts';
import { parseResume } from './resume.ts';

const role = (id: number, title: string, company: string, start: string, end: string, more: Partial<RoleRow> = {}): RoleRow =>
  ({ id, company, title, start, end, location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });
const ROLES = [role(1, 'Director of Engineering', 'Harborlight Systems', '2021-03', ''), role(2, 'Senior Engineer', 'Quillfeather Labs', '2016-01', '2021-02'),
  role(3, 'Support Lead', 'Tessellate Freight', '2010-05', '2012-08'), role(4, '', 'Lantern Notes', '2022-01', '2023-06', { standing: 'personal' })];
const TOP = '# Avery Lindqvist\navery@lindqvist.example\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console.\n';
const END = '\n## Skills\nGo\n';
const unresolved = (resume: string) => repairEntries(resume, ROLES).unresolved.map((f) => f.kind);

test('an invented job is unresolved under Projects, under any other section, as a bold line, and with no headings', () => {
  expect(unresolved(`${TOP}${END}`)).toEqual([]);
  expect(unresolved(`${TOP}\n## Projects\n### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed it.\n${END}`)).toEqual(['unknown']);
  expect(unresolved(`${TOP}\n## Consulting\n### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed it.\n${END}`)).toEqual(['unknown']);
  expect(unresolved(`${TOP}\n**Chief Architect, Nimbus Yard**\nJan 2015 – Feb 2021\n- Designed it.\n${END}`)).toEqual(['unknown']);
  expect(unresolved(`${TOP}\n__Chief Architect, Nimbus Yard__\n*Jan 2015 – Feb 2021*\n- Designed it.\n${END}`)).toEqual(['unknown']);
  expect(unresolved('Avery Lindqvist\n\nChief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed it.\n').length).toBeGreaterThan(0);
  // Written as plain lines or as a bullet with dates, under no entry the bank has.
  expect(unresolved(`${TOP}\n## Consulting\nChief Architect, Nimbus Yard, Jan 2015 – Feb 2021\n${END}`)).toEqual(['unknown']);
  expect(unresolved(`${TOP}\n## Consulting\n- Chief Architect at Nimbus Yard, 2015 to 2021.\n${END}`)).toEqual(['unknown']);
  // Hidden under a true entry, as a second dated line.
  expect(unresolved(`${TOP}Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed it.\n${END}`)).toEqual(['unknown']);
  // No job at all, when the bank has jobs.
  expect(unresolved('# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Skills\nGo\n')).toEqual(['unknown']);
});

test('what the bank holds is fine wherever it is written, and is put right there too', () => {
  // A personal project the bank has, under Projects.
  expect(unresolved(`${TOP}\n## Projects\n### Lantern Notes\nJan 2022 – Jun 2023 · Personal project\n- Built it.\n${END}`)).toEqual([]);
  // A true job as a bold line becomes a proper heading, with its true title.
  const bold = repairEntries(`${TOP}\n**Staff Engineer, Quillfeather Labs**\nJan 2016 – Feb 2021\n- Rebuilt the API.\n${END}`, ROLES);
  expect(bold.unresolved).toEqual([]);
  expect(bold.repaired.map((f) => f.kind)).toEqual(['title']);
  expect(bold.resume).toContain('### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the API.');
  // Education may carry dates and headings: it is not a job.
  expect(unresolved(`${TOP}${END}\n## Education\n### BSc Computer Science, Lakehead Polytechnic\n2004 – 2008\n`)).toEqual([]);
  // A date range in a bullet of a true entry, or in the summary, is not an entry.
  expect(unresolved(TOP.replace('Engineer.', 'Engineer who grew a team from 2019 to 2021.').replace('console.', 'console, in use from 2021 to now.') + END)).toEqual([]);
  // The person's own note may hold dates.
  const noted = ROLES.map((r) => (r.id === 1 ? { ...r, note: 'Ran Lantern Notes beside it from 2022 to 2023.' } : r));
  const once = repairEntries(`${TOP}${END}`, noted);
  expect(once.unresolved).toEqual([]);
  expect(repairEntries(once.resume, noted)).toEqual({ resume: once.resume, repaired: [], unresolved: [] });
});

test('a repair keeps the text whole when Earlier experience is above the entries', () => {
  const above = `# Avery Lindqvist\navery@lindqvist.example\n\n## Earlier experience\nHead of Support, Tessellate Freight (2009 – 2013)\nand more\n\n## Summary\nEngineer.\n\n## Experience\n### VP of Engineering, Harborlight Systems\nJan 2020 – Present\n- Build the dispatch console.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\nPreviously Intern, Jan 2015 – Dec 2015\n- Rebuilt the API.\n${END}`;
  const fixed = repairEntries(above, ROLES);
  expect(fixed.resume).toBe(`# Avery Lindqvist\navery@lindqvist.example\n\n## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012); and more\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the API.\n${END}`);
  expect(fixed.resume).not.toContain('VP of Engineering');
  // "and more" is on the Earlier experience line and matches no job: the version is not to be kept.
  expect(fixed.unresolved.map((f) => f.kind)).toEqual(['unknown']);
  const clean = repairEntries(above.replace('\nand more', ''), ROLES);
  expect(clean.unresolved).toEqual([]);
  expect(checkEntries(clean.resume, ROLES)).toEqual([]);
  expect(clean.resume).not.toContain('VP of Engineering');
  expect(clean.resume).not.toContain('Intern');
});

test('whatever a repair leaves that still disagrees with the bank is unresolved', () => {
  // Two true headings for one employer cannot both be kept.
  const twice = `${TOP}\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Run delivery.\n${END}`;
  expect(unresolved(twice)).toContain('split');
});

test('text with Windows line endings reads the same as text with plain ones', () => {
  const lf = `${TOP}\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the API.\n\n### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n${END}`;
  for (const crlf of [lf.replace(/\n/g, '\r\n'), lf.replace(/\n/g, '\r')]) {
    expect(parseResume(crlf)).toEqual(parseResume(lf));
    expect(parseResume(crlf).experience.map((e) => e.bullets.length)).toEqual([1, 1, 0]);
    expect(repairEntries(crlf.replace('Director of', 'VP of'), ROLES).resume).toBe(repairEntries(lf, ROLES).resume);
    expect(collapseEmpty(crlf, ROLES)).toBe(collapseEmpty(lf, ROLES));
    expect(collapseEmpty(crlf, ROLES)).not.toContain('\r');
  }
});
