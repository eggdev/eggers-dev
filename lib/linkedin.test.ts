// `bun test lib`: LinkedIn positions as data (rule 10). The export's Positions.csv is parsed, kept, and
// compared with the roles; each difference is a question. The fixture zip and every row here are invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, reset, role } from './scratch.ts';
import type { RoleRow } from './db.ts';
import { csvRows, diffPositions, positions, positionsIn, storePositions, syncLinkedin } from './linkedin.ts';
import { answer, openRaised, choiceAt } from './raised.ts';

beforeEach(reset);
const CSV = `Company Name,Title,Description,Location,Started On,Finished On
Harborlight Systems,Director of Engineering,"Runs engineering, alone.
Second line with a ""quote"".",Remote,Mar 2021,
"Quillfeather Labs, Inc.",Principal Engineer,,Duluth,Jan 2016,Mar 2021
Nimbus Yard,Analyst,,,2008,2009
`;
const flattened = `## Profile.csv\nFirst Name,Last Name\nAvery,Lindqvist\n\n## Positions.csv\n${CSV}\n## Education.csv\nSchool Name,Start Date\nLakehead Polytechnic,2004`;

test('Positions.csv is parsed, with quoted commas, quotes and line breaks', () => {
  expect(csvRows('a,"b,c","d ""e""\nf"\r\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"\nf'], ['1', '2', '3']]);
  const want = [{ company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', end: '', location: 'Remote' },
    { company: 'Quillfeather Labs, Inc.', title: 'Principal Engineer', start: '2016-01', end: '2021-03', location: 'Duluth' }, { company: 'Nimbus Yard', title: 'Analyst', start: '2008', end: '2009', location: '' }];
  expect(positionsIn(CSV)).toEqual(want);
  // As the upload flattens the zip: only the Positions section is read.
  expect(positionsIn(flattened)).toEqual(want);
  expect(positionsIn('Some pasted notes about work.')).toEqual([]);
});

test('the fixture export\'s positions are read from its zip', () => {
  const csv = Bun.spawnSync(['unzip', '-p', `${import.meta.dir}/../fixtures/linkedin.zip`, 'Positions.csv'], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString();
  // The place in the fixture is not compared: the fixture is not this test's to word.
  expect(positionsIn(`## Positions.csv\n${csv}`).map(({ location: _place, ...p }) => p)).toEqual([{ company: 'Acme', title: 'Staff Engineer', start: '2021-03', end: '' }]);
});

test('positions are kept as rows, and a newer export takes their place', () => {
  expect(storePositions(flattened, 7, 100)).toBe(3);
  expect(storePositions('no positions here', 8, 200)).toBe(0);
  expect(positions().length).toBe(3);
  expect(storePositions(`## Positions.csv\nCompany Name,Title,Started On,Finished On\nHarborlight Systems,Director of Engineering,Mar 2021,\n`, 9, 300)).toBe(1);
  expect(positions()).toEqual([{ company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', end: '', location: '' }]);
});

const r = (id: number, title: string, company: string, start: string, end: string, more: Partial<RoleRow> = {}): RoleRow => ({ id, company, title, start, end, location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });

test('the differences are title, employer, start and end, and what only one side has', () => {
  const roles = [r(1, 'Director of Engineering', 'Harborlight Systems', '2021-03', ''), r(2, 'Senior Engineer', 'Quillfeather Labs', '2016-01', '2021-02'), r(3, 'Support Lead', 'Tessellate Freight', '2010-05', '2012-08'),
    r(4, '', 'harborlight/dispatch', '2021-06', '2022-01', { part_of: 1 }), r(5, 'Maker', 'Lantern Notes', '2020-01', '', { standing: 'personal' })];
  const diffs = diffPositions(positionsIn(CSV), roles);
  expect(diffs.map((d) => [d.key, d.bank, d.linkedin])).toEqual([
    ['linkedin:title:2:principal engineer', 'Senior Engineer', 'Principal Engineer'],
    ['linkedin:end:2:2021-03', '2021-02', '2021-03'],
    ['linkedin:missing:nimbus yard|analyst|2008', '', 'Analyst, Nimbus Yard'],
    ['linkedin:absent:3', 'Support Lead, Tessellate Freight', ''],
  ]);
  expect(diffs[0].text).toBe('Your record says your title at Quillfeather Labs was “Senior Engineer”. LinkedIn says “Principal Engineer”. A background check compares them. Which one is right?');
  // A title paired by its employer alone may be a different real role, so that difference has a third answer.
  expect(diffs[0].choices).toEqual(['Your record is right: Senior Engineer', 'LinkedIn is right: Principal Engineer', 'Both are right: they were separate roles']);
  expect(diffs[1].choices).toEqual(['Your record is right: Feb 2021', 'LinkedIn is right: Mar 2021']);
  // The same title and start under another employer's name is an employer difference. A different start is a start difference.
  expect(diffPositions([{ company: 'Harbourlite Group', title: 'Director of Engineering', start: '2021-03', end: '', location: '' }], roles.slice(0, 1)).map((d) => d.field)).toEqual(['company']);
  expect(diffPositions([{ company: 'Harborlight Systems', title: 'Director of Engineering', start: '2020-11', end: '', location: '' }], roles.slice(0, 1)).map((d) => d.field)).toEqual(['start']);
  expect(diffPositions(positionsIn(CSV).slice(0, 1), roles.slice(0, 1))).toEqual([]);
});

test('each difference is a question, and "LinkedIn is right" writes its value into the role', () => {
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  expect(syncLinkedin(100)).toEqual([]);
  storePositions(flattened, 7, 100);
  syncLinkedin(200);
  expect(openRaised().map((q) => q.key)).toEqual(['linkedin:end:2:2021-03', 'linkedin:missing:nimbus yard|analyst|2008', 'linkedin:title:2:principal engineer']);
  expect(answer('linkedin:title:2:principal engineer', 0, '', 300, choiceAt('linkedin:title:2:principal engineer', 0))).toBe('');
  expect(answer('linkedin:end:2:2021-03', 1, '', 300, choiceAt('linkedin:end:2:2021-03', 1))).toBe('');
  expect(answer('linkedin:missing:nimbus yard|analyst|2008', 0, '', 300, choiceAt('linkedin:missing:nimbus yard|analyst|2008', 0))).toBe('');
  expect(db.query('SELECT title, end FROM roles WHERE id = 2').get()).toEqual({ title: 'Senior Engineer', end: '2021-03' });
  expect(db.query("SELECT title, start, end, standing FROM roles WHERE company = 'Nimbus Yard'").get()).toEqual({ title: 'Analyst', start: '2008', end: '2009', standing: 'employer' });
  // The title still differs, but the person said the bank is right: it is not asked again.
  syncLinkedin(400);
  expect(openRaised()).toEqual([]);
  // A later export with another title for the same job is a new difference, and is asked.
  storePositions(flattened.replace('Principal Engineer', 'Distinguished Engineer'), 8, 500);
  syncLinkedin(600);
  expect(openRaised().map((q) => q.key)).toEqual(['linkedin:title:2:distinguished engineer']);
});

test('"Both are right" changes nothing in the bank, and the two are compared apart from then on', () => {
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  storePositions('## Positions.csv\nCompany Name,Title,Started On,Finished On\nQuillfeather Labs,Principal Engineer,Mar 2021,Aug 2022\n', 7, 100);
  syncLinkedin(200);
  // Paired by employer alone: the title and both dates differ.
  expect(openRaised().map((q) => q.key)).toEqual(['linkedin:end:2:2022-08', 'linkedin:start:2:2021-03', 'linkedin:title:2:principal engineer']);
  const before = db.query('SELECT * FROM roles ORDER BY id').all();
  expect(answer('linkedin:title:2:principal engineer', 2, '', 300, choiceAt('linkedin:title:2:principal engineer', 2))).toBe('');
  expect(db.query('SELECT * FROM roles ORDER BY id').all()).toEqual(before);
  expect(db.query("SELECT answer FROM raised_questions WHERE key = 'linkedin:title:2:principal engineer'").get()).toEqual({ answer: 'Both are right: they were separate roles' });
  syncLinkedin(400);
  // The date questions were about one job and are gone. LinkedIn's role is now one the bank lacks, and the bank's one LinkedIn lacks.
  expect(openRaised().map((q) => q.key)).toEqual(['linkedin:absent:2', 'linkedin:missing:quillfeather labs|principal engineer|2021-03']);
});
