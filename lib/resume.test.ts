// `bun test lib`: the one resume parser, and the parse test that compares a PDF's text with the Markdown.
// The resumes here are invented. Nothing opens a database or a browser.
import { expect, test } from 'bun:test';
import { parseResume, rangesIn, readingOrder, sentences, skimView, splitHeading, toYm, wordCount } from './resume.ts';

const RESUME = `# Avery Lindqvist
Duluth, MN · avery@lindqvist.example · (218) 555-0142

## Summary
Engineer with 14 years building logistics software in TypeScript and Go. Built a dispatch console for 640 users and cut a billing run from 6 hours to 40 minutes. Works as the only engineer and ships alone.

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present · Remote
Sole engineer: designs, builds and runs every system below.
- Build the dispatch console that 640 users across 12 depots open every day, in TypeScript.
- Cut the nightly billing run from 6 hours to 40 minutes with Go and PostgreSQL.

### Staff Engineer, Quillfeather Labs
Jan 2019 – Feb 2021 · Contract · Duluth, MN
Previously Senior Engineer, Jan 2016 – Dec 2018
- Rebuilt the quoting API in Go, taking p95 latency from 900 ms to 210 ms.

## Earlier experience
Support Lead, Tessellate Freight (2010 – 2012); Dispatcher, Marrow & Pine Haulage (2008)

## Skills
TypeScript, Go, PostgreSQL, Kafka

## Education
BSc Computer Science, Lakehead Polytechnic
`;

test('a normal resume is read into its parts', () => {
  const r = parseResume(RESUME);
  expect(r.name).toBe('Avery Lindqvist');
  expect(r.contact).toContain('avery@lindqvist.example');
  expect(sentences(r.summary).length).toBe(3);
  expect(wordCount(r.summary)).toBeLessThan(50);
  expect(r.sections).toEqual(['Summary', 'Experience', 'Earlier experience', 'Skills', 'Education']);
  expect(r.experience.map((e) => [e.title, e.company])).toEqual([['Director of Engineering', 'Harborlight Systems'], ['Staff Engineer', 'Quillfeather Labs']]);
  const [first, second] = r.experience;
  expect(first.ranges).toEqual([{ start: '2021-03', end: '', text: 'Mar 2021 – Present' }]);
  expect(first.current).toBe(true);
  expect(first.place).toBe('Remote');
  expect(first.notes).toEqual(['Sole engineer: designs, builds and runs every system below.']);
  expect(first.bullets.length).toBe(2);
  expect(second.labels).toEqual(['Contract']);
  expect(second.place).toBe('Duluth, MN');
  expect(second.current).toBe(false);
  expect(second.previously).toEqual([{ title: 'Senior Engineer', ranges: [{ start: '2016-01', end: '2018-12', text: 'Jan 2016 – Dec 2018' }] }]);
  expect(r.earlier.map((e) => [e.title, e.company, e.ranges.map((x) => `${x.start}/${x.end}`).join()])).toEqual([['Support Lead', 'Tessellate Freight', '2010/2012'], ['Dispatcher', 'Marrow & Pine Haulage', '2008/2008']]);
  expect(r.skills).toEqual(['TypeScript', 'Go', 'PostgreSQL', 'Kafka']);
  expect(r.education).toEqual(['BSc Computer Science, Lakehead Polytechnic']);
  expect(r.unplaced).toEqual([]);
  expect(skimView(r)).toContain('First role: Director of Engineering, Harborlight Systems');
  expect(skimView(r).split('\n').filter((l) => l.startsWith('- ')).length).toBe(2);
});

test('a hand-broken resume is read as far as it can be, and never throws', () => {
  const broken = `stray line before the name
# Avery Lindqvist
## experience
- a bullet with no role above it
### Harborlight Systems
no dates here at all
* Built things
### Staff Engineer at Quillfeather Labs
2019 to now | Duluth
- Rebuilt the API
## Projects
### Side thing
- Made it
## SKILLS
Languages: Go, TypeScript; Tools: Kafka
## Hobbies
Rowing
###
`;
  const r = parseResume(broken);
  expect(r.name).toBe('Avery Lindqvist');
  expect(r.summary).toBe('');
  expect(r.unplaced).toContain('- a bullet with no role above it');
  expect(r.experience.map((e) => [e.title, e.company, e.bullets.length])).toEqual([['', 'Harborlight Systems', 1], ['Staff Engineer', 'Quillfeather Labs', 1]]);
  expect(r.experience[0].ranges).toEqual([]);
  expect(r.experience[0].notes).toEqual(['no dates here at all']);
  expect(r.experience[1].ranges[0]).toMatchObject({ start: '2019', end: '' });
  expect(r.experience[1].place).toBe('Duluth');
  expect(r.projects.map((e) => e.heading)).toEqual(['Side thing']);
  expect(r.skills).toEqual(['Go', 'TypeScript', 'Tools: Kafka']);
  expect(r.other).toEqual([{ section: 'Hobbies', lines: ['Rowing', '###'] }]);
  for (const odd of ['', '\n\n\n', '###', '## Experience\n### \n- x', '# \n## \n- ', null as unknown as string, '- only a bullet', '## Earlier experience\n;;;\n(2010)']) expect(() => parseResume(odd)).not.toThrow();
});

test('dates and headings are read in the forms people write', () => {
  expect(['Mar 2021', 'March 2021', '3/2021', '2021-03', '2021', 'Present', 'Sept. 2019'].map(toYm)).toEqual(['2021-03', '2021-03', '2021-03', '2021-03', '2021', '', '2019-09']);
  expect(rangesIn('Jan 2022 – Present; Mar 2017 - Dec 2019').map((x) => [x.start, x.end])).toEqual([['2022-01', ''], ['2017-03', '2019-12']]);
  expect(rangesIn('2019-2021').map((x) => [x.start, x.end])).toEqual([['2019', '2021']]);
  expect(splitHeading('Director, Software Engineering, Harborlight Systems')).toEqual({ title: 'Director, Software Engineering', company: 'Harborlight Systems' });
  expect(splitHeading('Engineer, Marrow & Pine, Inc.', ['Marrow & Pine, Inc.'])).toEqual({ title: 'Engineer', company: 'Marrow & Pine, Inc.' });
  expect(splitHeading('Harborlight Systems', ['Harborlight Systems'])).toEqual({ title: '', company: 'Harborlight Systems' });
});

// The text a PDF gives back: the heading's company moves to the dates line, dots become bars, lines wrap.
const asPdfText = (md: string) => md.replace(/^### (.*), (.*)$/gm, '$1\n$2 |').replace(/^#+ /gm, '').replace(/^- /gm, '• ').replace(/ · /g, ' | ').replace(/–/g, '-').replace(/\n+/g, ' ');

test('the parse test passes when the text keeps the order of the Markdown', () => {
  const got = readingOrder(RESUME, asPdfText(RESUME));
  expect(got).toMatchObject({ ok: true, missing: [], moved: [] });
  expect(got.headers).toEqual(['Summary', 'Experience', 'Earlier experience', 'Skills', 'Education']);
});

test('the parse test names what moved and what is missing', () => {
  const text = asPdfText(RESUME);
  // Two columns read wrongly: the Skills block comes out before the Summary.
  const skills = text.slice(text.indexOf('Skills TypeScript'), text.indexOf('Education BSc'));
  const moved = readingOrder(RESUME, text.replace(skills, '').replace('Summary Engineer', `${skills}Summary Engineer`));
  expect(moved.ok).toBe(false);
  expect(moved.moved).toEqual(['the Skills header']);
  // A bullet that did not come out as text at all.
  const missing = readingOrder(RESUME, text.replace(/• Rebuilt the quoting API[^•]*?210 ms\./, ''));
  expect(missing.ok).toBe(false);
  expect(missing.missing).toEqual(['the bullet “Rebuilt the quoting API in Go,…”']);
  // A role's heading that comes out after its own bullets.
  const late = readingOrder(RESUME, text.replace('Staff Engineer Quillfeather Labs | ', '').replace('Earlier experience Support', 'Staff Engineer Quillfeather Labs | Earlier experience Support'));
  expect(late.moved).toContain('the bullet “Rebuilt the quoting API in Go,…”');
});
