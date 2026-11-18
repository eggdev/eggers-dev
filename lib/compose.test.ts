// `bun test lib`: writing a resume end to end, with a stand-in for every model call (fakeAsk in lib/llm.ts) and
// a scratch database of an invented person (lib/scratch.ts). No model, no browser, no real data.
// It covers: the posting map and the metrics inventory reach the writer; what a model changes in a title or a
// date is put back; no posting term is pasted into Skills; flags are stored; a hand edit is flagged, never rewritten.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { codeFlags, fixable, projectNames, sigOf } from './checks.ts';
import { assess, bank, compose, FactsError, fitOf, keepEarlier, publish, refreshSkills, review, storeComposed, topRequirements, weigh, type Analysis, type JobRow, type Requirement } from './jobs.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { parseResume } from './resume.ts';
import { markSkills, syncSkills } from './skills.ts';
import { judge } from './derived.ts';
import { addFact, addProject, addRole, derivedNow, keptLines, patchProject, patchRole } from './record.ts';
import { checkEntries, employers, repairEntries } from './entries.ts';
import type { RoleRow } from './db.ts';
import { CONTEXT, KEPT_LINES } from './writing.ts';

const POSTING = 'Staff Engineer at Nimbus Yard. You will build Go services on Kafka, with observability and cross-team collaboration. Our first platform engineer: scale to millions of events.';
const TERMS = ['Go', 'Kafka', 'observability', 'cross-team collaboration', 'Rust'];
const REQS: Requirement[] = [
  { text: 'Go services in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API in Go.', roles: ['role:2'], best: 'fact:4', bestText: 'Rebuilt the quoting API. [p95 latency 900 ms to 210 ms]', weight: 0.9 },
  { text: 'Rust', need: 'must', coverage: 'none', evidence: 'Nothing in the bank.', roles: [], best: '', weight: 0 },
  { text: 'Kafka', need: 'nice', coverage: 'strong', evidence: 'Used at Quillfeather.', roles: ['role:2'], best: 'role:2', bestText: 'Senior Engineer, Quillfeather Labs', weight: 0.9 },
  { text: 'Works alone at scale', need: 'implied', coverage: 'partial', evidence: 'Sole engineer at Harborlight.', roles: ['role:1'], best: 'fact:1', bestText: 'Built the dispatch console. [640 users across 12 depots]', weight: 0.5 },
  { text: 'Owns delivery end to end', need: 'must', coverage: 'partial', evidence: 'Director at Harborlight.', roles: ['role:1'], best: 'role:1', bestText: 'Director of Engineering, Harborlight Systems', weight: 0.5 },
];

// What a careless writer returns: a title raised, a date moved, a role with no bullets, posting phrases in Skills, a metric left out.
const WRITTEN = `# A. Lindqvist
old contact line

## Summary
Engineer with 14 years building logistics software in Go and TypeScript. Built a dispatch console for 640 users across 12 depots. Works as the only engineer.

## Experience
### VP of Engineering, Harborlight Systems
Mar 2021 – Present · Remote
- Build the dispatch console that 640 users across 12 depots open every day.

### Senior Engineer, Quillfeather Labs
Jan 2015 – Feb 2021
- Rebuilt the quoting API in Go on Kafka.

### Support Lead, Tessellate Freight
May 2010 – Aug 2012

## Skills
Go, Kafka, cross-team collaboration, observability, enterprise

## Education
BSc Computer Science, Lakehead Polytechnic
`;

let calls: Ask[] = [];
const kind = (c: Ask) => (c.prompt.startsWith('You are measuring one job posting') ? 'write' : c.prompt.startsWith('You are a recruiter with six seconds') ? 'glance' : c.prompt.startsWith('You are fixing the top') ? 'fix' : c.prompt.startsWith('You are revising') ? 'revise' : 'read');
const answered = (yes: boolean) => ({ conclusion: 'A hands-on engineering lead.', misleading: '', questions: [{ question: 'Is the director title a step away from building?', who: 'person' }], top: [0, 1, 2].map(() => ({ requirement: '', answered: yes, note: yes ? '' : 'Not at the top.' })) });
function model(written = WRITTEN, glance = answered(true)) {
  calls = [];
  fakeAsk((c) => {
    calls.push(c);
    const k = kind(c);
    if (k === 'write') return { resume: written, changes: ['Led with the console.'], questions: ['Who used the quoting API day to day?'] };
    if (k === 'glance') return glance;
    if (k === 'fix') return { resume: written.replace('Works as the only engineer.', 'Runs delivery alone.'), changes: ['Reworded the summary.'] };
    if (k === 'revise') return { resume: written, changes: [], questions: [] };
    return { score: 9, note: 'Clear.', problems: [] };
  });
}
function job(resume = ''): number {
  return (db.query("INSERT INTO jobs (posting, title, company, status, fit, analysis, resume, resume_status, created_at) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', 60, ?, ?, 'running', 1) RETURNING id")
    .get(POSTING, JSON.stringify({ verdict: 'A fair fit.', requirements: REQS, strengths: [], risks: [], changes: [], gaps: [], terms: { inResume: [], inBankOnly: [], missing: TERMS } }), resume) as { id: number }).id;
}
const analysisOf = (id: number) => JSON.parse((db.query('SELECT analysis FROM jobs WHERE id = ?').get(id) as { analysis: string }).analysis) as Analysis;
const resumeOf = (id: number) => (db.query('SELECT resume FROM jobs WHERE id = ?').get(id) as { resume: string }).resume;

beforeEach(() => { seed(); process.env.EGG_COUNCIL = 'off'; delete process.env.EGG_SKIM; });
afterEach(() => { fakeAsk(); delete process.env.EGG_COUNCIL; delete process.env.EGG_SKIM; delete process.env.EGG_LINKS; });
// The tests that count the calls of the writing loop have stand-ins that write no fact keys: with links on, every line
// would also be sent back as citing no fact (lib/links.ts). They run with links off; the keys are tested in
// lib/compose.links.test.ts.
const noLinks = () => { process.env.EGG_LINKS = 'off'; };

test('the top three requirements are required, then implied, then preferred, by weight, and never one the bank cannot answer', () => {
  expect(topRequirements(REQS).map((r) => r.text)).toEqual(['Go services in production', 'Owns delivery end to end', 'Works alone at scale']);
  // An older reading has only must and nice, and no weights: it still reads.
  const old = [{ text: 'a', need: 'nice', coverage: 'strong', evidence: '' }, { text: 'b', need: 'must', coverage: 'partial', evidence: '' }, { text: 'c', need: 'must', coverage: 'none', evidence: '' }] as Requirement[];
  expect(topRequirements(old).map((r) => r.text)).toEqual(['b', 'a']);
  expect(fitOf(old)).toBe(Math.round(((1 + 1.5) / 7) * 100));
  expect(fitOf([{ text: 'i', need: 'implied', coverage: 'strong', evidence: '' }, { text: 'n', need: 'nice', coverage: 'none', evidence: '' }])).toBe(67);
});

test('the first reading maps the posting: required, preferred and implied, each with one strongest evidence that the bank really has', async () => {
  let asked: Ask | undefined;
  fakeAsk((c) => { asked = c; return { title: 'Staff Engineer', company: 'Nimbus Yard', place: 'Remote', verdict: 'A fair fit.', strengths: [], risks: [], gaps: [], knockouts: [], checks: [], terms: ['Go', 'Kafka'],
    requirements: [{ text: 'Go services in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API.', roles: ['role:2'], best: 'fact:4' },
      { text: 'Runs systems at scale', need: 'implied', coverage: 'partial', evidence: 'The console.', roles: ['role:1'], best: 'role:1' },
      { text: 'Kafka', need: 'nice', coverage: 'strong', evidence: 'Used at Quillfeather.', roles: ['role:2'], best: 'fact:999' },
      { text: 'Rust', need: 'must', coverage: 'none', evidence: 'Nothing.', roles: [], best: 'fact:1' }] }; });
  const a = await assess(POSTING);
  expect(a.analysis.requirements.map((r) => [r.need, r.best, r.bestText])).toEqual([
    ['must', 'fact:4', 'Rebuilt the quoting API. [p95 latency 900 ms to 210 ms]'], ['implied', 'role:1', 'Director of Engineering, Harborlight Systems'],
    ['nice', '', ''], // a key the bank does not have is not kept
    ['must', '', '']]); // nothing can be the evidence for what the bank does not cover
  expect(a.analysis.requirements.every((r) => typeof r.weight === 'number')).toBe(true);
  const schema = JSON.stringify(asked!.schema);
  expect(schema).toContain('"enum":["must","nice","implied"]');
  expect(asked!.prompt.includes('each with a "need" of "implied"')).toBe(true);
  // The first reading sees the facts with their keys, and writes no resume.
  expect(asked!.prompt.includes('"key":"fact:4"')).toBe(true);
  expect(asked!.prompt.includes('"resume":')).toBe(false);
});

test('the writer is given the posting map, the top three, the metrics inventory and each employer as one entry', async () => {
  db.run("INSERT INTO roles (id, company, title, start, end, standing) VALUES (4, 'Quillfeather Labs', 'Engineer', '2013-01', '2015-12', 'employer')");
  fact(4, 'Wrote the first quoting service.', '', 'Go');
  model();
  await compose(POSTING, 2, TERMS, REQS);
  const prompt = calls.find((c) => kind(c) === 'write')!.prompt;
  // Each line is checked by itself, so a failure names the line and does not print the whole prompt.
  const has = (text: string) => expect([text, prompt.includes(text)]).toEqual([text, true]), lacks = (text: string) => expect([text, prompt.includes(text)]).toEqual([text, false]);
  has('- [required, strong] Go services in production Strongest evidence: fact:4 “Rebuilt the quoting API. [p95 latency 900 ms to 210 ms]”');
  has('- [required, none] Rust The bank has nothing for this: do not claim it.');
  has('- [implied, partial] Works alone at scale Strongest evidence: fact:1');
  has('1. Go services in production Strongest evidence: fact:4');
  has('2. Owns delivery end to end');
  has('3. Works alone at scale');
  has('Each of these must be visibly answered in the top third of page one');
  const bank = JSON.parse(prompt.slice(prompt.indexOf('The bank, as JSON:\n') + 19, prompt.indexOf('\n\nThe posting has already been read')));
  // The count of tests is not an impact metric, so it is not in the inventory.
  expect(bank.metrics_inventory.map((m: { kind: string }) => m.kind)).toEqual(['users', 'time saved', 'latency', 'team size']);
  expect(bank.metrics_inventory[0]).toEqual({ fact: `fact:${bank.entries[0].roles[0].facts[0].key.slice(5)}`, role: 'role:1', kind: 'users', metric: '640 users across 12 depots' });
  const quill = bank.entries.find((e: { heading: string }) => e.heading === 'Senior Engineer, Quillfeather Labs');
  expect(quill).toMatchObject({ dates: 'Jan 2016 – Feb 2021 · Duluth, MN', previously: ['Previously Engineer, Jan 2013 – Dec 2015'], earlier: 'Senior Engineer, Quillfeather Labs (2013 – 2021)', current: false });
  expect(quill.roles.map((r: { key: string }) => r.key)).toEqual(['role:2', 'role:4']);
  // The old contradictions are gone from the instructions.
  for (const gone of ['"## Projects"', 'Summary, Experience, Projects', 'past-tense verb for what the person did', 'Summary or in the first bullets', 'with no bullets', 'heading and dates alone', 'Leaving a number out is always allowed', 'Summary is two sentences']) lacks(gone);
  has('Under the current role (its dates end in "Present") every bullet opens with a present-tense verb');
  has('At most three sentences and about 50 words');
  has('No other section, and no Projects section.');
});

test('a changed title and date are put back, an empty entry is collapsed, and no posting term is pasted into Skills', async () => {
  noLinks();
  model();
  const c = await compose(POSTING, 2, TERMS, REQS);
  const r = parseResume(c.resume);
  expect(r.name).toBe('Avery Lindqvist');
  expect(r.contact).toContain('(218) 555-0142');
  expect(r.experience.map((e) => [e.heading, e.ranges.map((x) => x.text).join()])).toEqual([['Director of Engineering, Harborlight Systems', 'Mar 2021 – Present'], ['Senior Engineer, Quillfeather Labs', 'Jan 2016 – Feb 2021']]);
  expect(r.earlier.map((e) => e.text)).toEqual(['Support Lead, Tessellate Freight (2010 – 2012)']);
  expect(c.repairs.length).toBe(2);
  expect(c.repairs[0]).toContain('“VP of Engineering”');
  // Only real tools and languages from the person's own list: the posting's first, then the rest. No phrase from the posting.
  expect(r.skills).toEqual(['Go', 'Kafka', 'PostgreSQL', 'TypeScript']);
  // "observability" is in no bullet and no fact, Rust is not in the bank: neither was added anywhere.
  expect(c.terms).toEqual({ inResume: ['Go', 'Kafka'], inBankOnly: [], missing: ['observability', 'cross-team collaboration', 'Rust'] });
  expect(c.resume).not.toContain('observability');
  expect(c.map.top.map((t) => [t.text, t.need, t.best])).toEqual([['Go services in production', 'must', 'fact:4'], ['Owns delivery end to end', 'must', 'role:1'], ['Works alone at scale', 'implied', 'fact:1']]);
  expect(c.questions).toEqual(['Who used the quoting API day to day?']);
  // One call to write and one to skim: the skim found nothing a rewrite could fix.
  expect(calls.map(kind)).toEqual(['write', 'glance']);
  expect(calls[1].prompt).toContain('- Go services in production\n- Owns delivery end to end\n- Works alone at scale');
});

test('what was written is stored with its map, skim and flags', async () => {
  model(WRITTEN, answered(false));
  const id = job(), c = await compose(POSTING, 2, TERMS, REQS);
  // Two rewrites, three skims, and the top is still not answered: it becomes a flag, not a fourth try.
  expect(calls.map(kind)).toEqual(['write', 'glance', 'fix', 'glance', 'fix', 'glance']);
  expect(storeComposed(id, c, 'sig', 5)).toBe(true);
  await publish(id, false);
  const a = analysisOf(id);
  expect(resumeOf(id)).toBe(c.resume);
  expect(a.map!.top.length).toBe(3);
  expect(a.skim).toMatchObject({ revisions: 2, questions: ['Is the director title a step away from building?'] });
  expect(a.questions).toEqual(['Who used the quoting API day to day?']);
  const kinds = a.flags!.map((f) => f.kind);
  expect(kinds.filter((k) => k === 'top-requirement').length).toBe(3);
  for (const k of ['metrics-dropped', 'facts-repaired', 'skills-unconfirmed', 'skim-question']) expect(kinds).toContain(k);
  expect(kinds).not.toContain('facts');
  const dropped = a.flags!.find((f) => f.kind === 'metrics-dropped')!;
  expect(dropped.text).toBe('This resume shows 1 of the 3 measured results your record holds for the jobs it gives bullets to. Left out: from 6 hours to 40 minutes; p95 latency 900 ms to 210 ms.');
  expect(dropped.items).toEqual(['from 6 hours to 40 minutes', 'p95 latency 900 ms to 210 ms']);
  expect(a.flags!.find((f) => f.kind === 'top-requirement')!.text).toContain('does not see an answer to “Go services in production”');
  // Asked for again while it was being written: this one is dropped.
  db.query("UPDATE jobs SET resume_status = 'queued' WHERE id = ?").run(id);
  expect(storeComposed(id, { ...c, resume: 'another' }, 'sig', 6)).toBe(false);
  expect(resumeOf(id)).toBe(c.resume);
});

test('a hand edit is flagged and never rewritten', async () => {
  model();
  const id = job(), c = await compose(POSTING, 2, TERMS, REQS);
  storeComposed(id, c, 'sig', 5);
  const edited = c.resume.replace('### Director of Engineering, Harborlight Systems', '### VP of Engineering, Harborlight Systems').replace('Jan 2016 – Feb 2021', 'Jan 2014 – Feb 2021')
    .replace('Go, Kafka, PostgreSQL, TypeScript', 'Go, Kafka, stakeholder management').replace('## Earlier experience', '## Projects\n### Lantern Notes\n- Built it.\n\n## Earlier experience');
  db.query('UPDATE jobs SET resume = ?, edited = 1 WHERE id = ?').run(edited, id);
  await publish(id, false);
  expect(resumeOf(id)).toBe(edited);
  const flags = analysisOf(id).flags!;
  expect(flags.filter((f) => f.kind === 'facts').map((f) => [f.severity, f.text])).toEqual([
    ['high', 'The resume gives the title “VP of Engineering” at Harborlight Systems. Your record says “Director of Engineering”. A background check verifies titles.'],
    ['high', 'The resume gives the dates Jan 2014 – Feb 2021 for Senior Engineer, Quillfeather Labs. Your record says Jan 2016 – Feb 2021.'],
    // An entry under another section is checked too. In the person's own edit it is a flag, and the text stays.
    ['high', 'The resume has an entry “Lantern Notes”. Your record has no job or project by that name, or with that title and those dates.'],
  ]);
  expect(flags.find((f) => f.kind === 'skills-other')!.items).toEqual(['stakeholder management']);
  expect(flags.find((f) => f.kind === 'headings')!.text).toContain('“Projects”');
  // What was repaired at writing time belongs to the text as written, so it is no longer shown.
  expect(flags.map((f) => f.kind)).not.toContain('facts-repaired');
  // The skim read the summary and first role, which the edit changed.
  expect(flags.map((f) => f.kind)).toContain('skim-stale');
  // Marking skills rewrites the Skills line of written resumes only.
  markSkills([{ name: 'Go', mark: 'confident' }], true, 10);
  expect(refreshSkills()).toEqual([]);
  expect(resumeOf(id)).toBe(edited);
});

test('the code checks flag a long or third-person summary, a zero-bullet entry and the wrong tense', () => {
  const resume = `# Avery Lindqvist\n\n## Summary\nAvery is an engineer. She builds software. She leads teams. She ships. ${'More words here. '.repeat(20)}\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console for 640 users, cutting a run from 6 hours to 40 minutes.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n`;
  const kinds = codeFlags(resume, 2).map((f) => f.kind);
  for (const k of ['summary-long', 'summary-person', 'zero-bullets', 'tense']) expect(kinds).toContain(k);
  expect(kinds).not.toContain('metrics-dropped');
  // A job that ended 8 or more years ago with two bullets is flagged; with one it is not.
  const old = (bullets: string) => codeFlags(`# Avery Lindqvist\n\n## Experience\n### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n${bullets}`, 2).filter((f) => f.kind === 'old-role').length;
  expect([old('- Led the support desk, a team of 6 people.\n- Wrote the handbook.\n'), old('- Led the support desk, a team of 6 people.\n')]).toEqual([1, 0]);
});

test('a version that names a job the bank does not have is never returned', async () => {
  const invented = WRITTEN.replace('### Senior Engineer, Quillfeather Labs\nJan 2015 – Feb 2021', '### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021');
  model(invented);
  process.env.EGG_SKIM = 'off';
  const err = await compose(POSTING, 2, TERMS, REQS).catch((e) => e);
  expect(err).toBeInstanceOf(FactsError);
  expect((err as Error).message).toContain('“Chief Architect, Nimbus Yard”');
  // The earlier resume stands, and says so.
  const id = job('# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the console.\n');
  keepEarlier(id, (err as Error).message);
  expect(analysisOf(id).flags!.find((f) => f.kind === 'facts-repaired')!.text).toContain('was not kept');
});

test('with the council on, the readers and the reviser hold the same rules and the skim follows', async () => {
  noLinks();
  delete process.env.EGG_COUNCIL;
  model();
  const c = await compose(POSTING, 2, TERMS, REQS);
  // This short invented resume is under the rule-based score, so the council rewrites to its cap: three readers a round, a reviser between rounds, then the skim.
  const order = calls.map(kind);
  expect([order[0], order[order.length - 1]]).toEqual(['write', 'glance']);
  expect([order.filter((k) => k === 'read').length, order.filter((k) => k === 'revise').length, order.filter((k) => k === 'glance').length]).toEqual([12, 3, 1]);
  expect(c.review).toMatchObject({ score: 9, rounds: 3 });
  const reader = calls.find((x) => kind(x) === 'read')!.prompt, reviser = calls.find((x) => kind(x) === 'revise')!.prompt;
  const holds = (prompt: string, text: string, want = true) => expect([text, prompt.includes(text)]).toEqual([text, want]);
  for (const p of [reader, reviser]) { holds(p, 'At most three sentences and about 50 words'); holds(p, 'No other section, and no Projects section.'); holds(p, 'Summary, Experience, Projects', false); }
  holds(reviser, 'Keeping the best metrics:');
  holds(reviser, '"metrics_inventory"');
  holds(reviser, 'Never add them as a list.');
  // The council reads the resume as it will be sent: the true title, the person's own skills.
  holds(reader, '### Director of Engineering, Harborlight Systems');
  holds(reader, 'cross-team collaboration, observability', false);
  // The review of a resume already written runs the council, then the skim.
  const id = job(c.resume);
  calls = [];
  await review({ ...(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as never as import('./jobs.ts').JobRow) }, false);
  expect(calls.map(kind)).toEqual(['read', 'read', 'read', 'glance']);
  expect(analysisOf(id).skim!.top.length).toBe(3);
});

// The careless resume with one more thing in it: a job the bank does not have, written where the first check did not look.
const PLACES: [string, string][] = [
  ['under Projects', WRITTEN.replace('## Skills', '## Projects\n### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed the platform.\n\n## Skills')],
  ['under a section with another name', WRITTEN.replace('## Skills', '## Consulting\n### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed the platform.\n\n## Skills')],
  ['as a bold line in place of a heading', WRITTEN.replace('## Skills', '**Chief Architect, Nimbus Yard**\nJan 2015 – Feb 2021\n- Designed the platform.\n\n## Skills')],
  ['with no headings at all', 'Avery Lindqvist\n\nChief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed the platform.\n\nDirector of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the console.\n'],
  ['with Earlier experience above Experience', WRITTEN.replace('## Summary', '## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012); Chief Architect, Nimbus Yard (2015 – 2021)\n\n## Summary')],
];
for (const [where, written] of PLACES) {
  test(`an invented job ${where} is never stored`, async () => {
    model(written);
    process.env.EGG_SKIM = 'off';
    const id = job('# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the console.\n');
    const before = resumeOf(id), err = await compose(POSTING, 2, TERMS, REQS).catch((e) => e);
    expect(err).toBeInstanceOf(FactsError);
    expect(resumeOf(id)).toBe(before);
  });
}

test('a changed title is put back whole when Earlier experience is above Experience, and when the text has Windows line endings', async () => {
  const above = WRITTEN.replace('## Summary', '## Earlier experience\nHead of Support, Tessellate Freight (2009 – 2013)\n\n## Summary').replace('### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n\n', '');
  for (const written of [above, above.replace(/\n/g, '\r\n')]) {
    model(written);
    process.env.EGG_SKIM = 'off';
    const c = await compose(POSTING, 2, TERMS, REQS), r = parseResume(c.resume);
    expect(c.resume).not.toMatch(/VP of Engineering|Head of Support|Jan 2015|\r/);
    expect(r.experience.map((e) => [e.heading, e.ranges.map((x) => x.text).join(), e.bullets.length])).toEqual([['Director of Engineering, Harborlight Systems', 'Mar 2021 – Present', 1], ['Senior Engineer, Quillfeather Labs', 'Jan 2016 – Feb 2021', 1]]);
    expect(r.earlier.map((e) => e.text)).toEqual(['Support Lead, Tessellate Freight (2010 – 2012)']);
    expect(r.sections).toEqual(['Earlier experience', 'Summary', 'Experience', 'Skills', 'Education']);
  }
});

test('a review never rewrites a resume the person edited: the readers only score it', async () => {
  delete process.env.EGG_COUNCIL;
  model();
  const mine = '# Avery Lindqvist\nmy own contact line\n\n## Summary\nEngineer, in my own words.\n\n## Experience\n### VP of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n## Skills\nGo, synergy\n';
  const id = job(mine);
  db.query('UPDATE jobs SET edited = 1 WHERE id = ?').run(id);
  calls = [];
  const got = await review(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow, false);
  // Three readers, no reviser, no skim, no rewrite. The text is byte for byte the person's.
  expect(calls.map(kind)).toEqual(['read', 'read', 'read']);
  expect(resumeOf(id)).toBe(mine);
  expect(got).toMatchObject({ score: 9, rounds: 0 });
  expect(analysisOf(id).review).toMatchObject({ score: 9 });
  // The changed title is a flag, as for any hand edit.
  expect(analysisOf(id).flags!.filter((f) => f.kind === 'facts').length).toBe(1);
});

// The readers' weak lines of an edited resume are stored with the signature of the text they read, so the resume screen
// shows them while that text stands.
test('a review of an edited resume keeps its readers’ weak lines with the signature of the text they read', async () => {
  delete process.env.EGG_COUNCIL;
  const mine = '# Avery Lindqvist\nmy own contact line\n\n## Summary\nEngineer, in my own words.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n## Skills\nGo\n';
  fakeAsk(() => ({ score: 7, note: 'Thin.', problems: [{ quote: 'Built the console.', why: 'It says nothing of what came of it.', fix: 'Add the result.' }] }));
  const id = job(mine);
  db.query('UPDATE jobs SET edited = 1 WHERE id = ?').run(id);
  await review(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow, false);
  const r = analysisOf(id).review!;
  expect(r.problems!.map((x) => x.quote)).toContain('Built the console.');
  expect(r.problemsSig).toBe(sigOf(mine));
});

test('a review whose rewrite names a job the bank does not have keeps the resume, and does not store that review', async () => {
  delete process.env.EGG_COUNCIL;
  process.env.EGG_SKIM = 'off';
  const good = '# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the console for 640 users.\n';
  const invented = good.replace('## Experience', '## Experience\n### Chief Architect, Nimbus Yard\nJan 2015 – Feb 2021\n- Designed the platform.\n');
  calls = [];
  // The readers prefer the rewrite, so the council hands back the version with the invented job.
  fakeAsk((c) => { calls.push(c); return kind(c) === 'revise' ? { resume: invented, changes: ['Added a job.'], questions: [] } : { score: c.prompt.includes('Nimbus Yard, ') || c.prompt.includes('Chief Architect, Nimbus Yard') ? 9.5 : 5, note: 'n', problems: [] }; });
  const id = job(good);
  const before = analysisOf(id);
  const got = await review(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow, false);
  expect(got).toBeUndefined();
  expect(resumeOf(id)).toBe(good);
  const after = analysisOf(id);
  expect(after.review).toEqual(before.review);
  expect(after.flags!.find((f) => f.kind === 'facts-repaired')!.text).toContain('“Chief Architect, Nimbus Yard”');
});

// ---------- Stage 3: projects, the new fact fields and the kept lines of "How you work" ----------
// Role 1's dispatch console in a project of its own: a situation and a result, no "what I did", and what was learned.
// Role 2's quoting API in a project with only a name. One more project with no fact. Everything is invented.
const project = (roleId: number, title: string, parts: { situation?: string; did?: string; result?: string; learned?: string; lives?: string } = {}) =>
  (db.query('INSERT INTO projects (role_id, title, situation, did, result, learned, lives, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1) RETURNING id')
    .get(roleId, title, parts.situation ?? '', parts.did ?? '', parts.result ?? '', parts.learned ?? '', parts.lives ?? '') as { id: number }).id;
const fileIn = (factId: number, projectId: number) => db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(projectId, factId);
const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;
function withProjects() {
  const console = project(1, 'Dispatch console', { situation: 'Schedulers planned 35 depots on paper.', result: 'One console for every depot.', learned: 'I learned to ship in 3 week steps.', lives: 'console.example' });
  const quoting = project(2, 'Quoting API');
  project(1, 'Nothing filed yet', { situation: 'A plan with 9 parts.' });
  fileIn(idOf('Built the dispatch console that schedulers use every day.'), console);
  fileIn(idOf('Rebuilt the quoting API.'), quoting);
  db.query("UPDATE facts SET baseline = '9 hours', team = 'about 4 people', own_part = 'I wrote the scheduler.' WHERE id = ?").run(idOf('Cut the nightly billing run.'));
  db.query("UPDATE facts SET baseline = 'There was none' WHERE id = ?").run(idOf('Built the dispatch console that schedulers use every day.'));
  return { console, quoting };
}
const writePrompt = () => calls.find((c) => kind(c) === 'write')!.prompt;
const bankOf = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('The bank, as JSON:\n') + 19, prompt.indexOf('\n\nThe posting has already been read')));

test('a project of a role reaches the writer with its facts and only the parts that are set; no fact is sent twice; learned never', async () => {
  const { console, quoting } = withProjects();
  model();
  await compose(POSTING, 2, TERMS, REQS);
  const prompt = writePrompt(), bank = bankOf(prompt);
  const harbor = bank.entries.find((e: { heading: string }) => e.heading.includes('Harborlight')).roles[0];
  expect(harbor.projects).toEqual([{ key: `project:${console}`, name: 'Dispatch console', context: { situation: 'Schedulers planned [number] depots on paper.', result: 'One console for every depot.' },
    facts: [{ key: `fact:${idOf('Built the dispatch console that schedulers use every day.')}`, kind: 'accomplishment', text: 'Built the dispatch console that schedulers use every day.', detail: '', metric: '640 users across 12 depots', skills: 'TypeScript, PostgreSQL' }] }]);
  // Its fact left the role's own list; the fields a fact gained are sent when set, and "There was none" is not a value.
  expect(harbor.facts.map((f: { text: string }) => f.text)).toEqual(['Cut the nightly billing run.', 'Wrote the test suite for the console.']);
  expect(harbor.facts[0]).toMatchObject({ baseline: '9 hours', team: 'about 4 people', own_part: 'I wrote the scheduler.' });
  expect(Object.keys(harbor.facts[1])).not.toContain('baseline');
  // A project with only a name still groups its facts, with no context.
  const quill = bank.entries.find((e: { heading: string }) => e.heading.includes('Quillfeather')).roles[0];
  expect(quill.projects).toEqual([{ key: `project:${quoting}`, name: 'Quoting API', facts: [expect.objectContaining({ text: 'Rebuilt the quoting API.' })] }]);
  expect(quill.facts.map((f: { text: string }) => f.text)).toEqual(['Ran weekly code review sessions.']);
  // Every fact once in the whole bank; the project with no fact, what was learned and where it lives are not sent.
  const keys = JSON.stringify(bank).match(/"key":"fact:\d+"/g)!;
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.length).toBe((db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n);
  for (const gone of ['Nothing filed yet', 'A plan with 9 parts', 'I learned to ship', 'console.example', 'There was none']) expect([gone, prompt.includes(gone)]).toEqual([gone, false]);
  // The writer is told what context is, and that titles, employers and dates never come from a project.
  expect(prompt).toContain(CONTEXT);
});

test('with no project and no new field set, the writer gets the bank exactly as before', async () => {
  model();
  await compose(POSTING, 2, TERMS, REQS);
  const bank = bankOf(writePrompt());
  for (const e of bank.entries) for (const r of e.roles) expect([r.key, r.projects]).toEqual([r.key, []]);
  expect(JSON.stringify(bank)).not.toMatch(/"(baseline|team|own_part|context)"/);
});

test('kept lines of How you work go to the writer in a block of their own, never in the bank; a rejected, undecided or no longer true line is not sent', async () => {
  fact(1, 'Managed a team of 5 engineers.');
  fact(3, 'Wrote the desk scripts.', '', 'Go');
  syncSkills(1);
  const lines = derivedNow();
  expect(lines.map((l) => l.key)).toEqual(['led', 'skill:go']);
  expect(judge(lines, 'led', 'kept', 2)).toBe('');
  model();
  await compose(POSTING, 2, TERMS, REQS);
  let prompt = writePrompt();
  const led = 'Your record shows you managing, hiring or growing a team in 2 of 3 roles.';
  expect(prompt).toContain(`${KEPT_LINES}\n- Your record shows you managing, hiring or growing a team in [number] of [number] roles.`);
  expect(prompt).not.toContain(led);
  expect(KEPT_LINES).toBe('Counted from the record and confirmed by the person. Not facts: never print one, never quote its numbers; use them only to choose which facts lead.');
  expect(JSON.stringify(bankOf(prompt))).not.toContain('managing, hiring');
  // The skill line is undecided: not sent. Rejected: not sent either.
  expect(prompt).not.toContain('Go runs through');
  expect(judge(derivedNow(), 'skill:go', 'rejected', 3)).toBe('');
  expect(keptLines().map((l) => l.key)).toEqual(['led']);
  // The kept line no longer holds (its fact is gone): it is not sent, and the block is left out.
  db.query('DELETE FROM facts WHERE text = ?').run('Managed a team of 5 engineers.');
  expect(keptLines()).toEqual([]);
  model();
  await compose(POSTING, 2, TERMS, REQS);
  prompt = writePrompt();
  expect(prompt).not.toContain(KEPT_LINES);
  expect(prompt).not.toContain(led);
});

test('a number whose value stands in a project\'s background and in no fact of the employer is flagged; a kept line is no context', () => {
  withProjects();
  fact(1, 'Managed a team of 5 engineers.');
  expect(judge(derivedNow(), 'led', 'kept', 2)).toBe('');
  const resume = (summary: string, bullets: string[]) => `# Avery Lindqvist\n\n## Summary\n${summary}\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n${bullets.map((b) => `- ${b}`).join('\n')}\n`;
  const flagged = (text: string) => codeFlags(text, 2).filter((f) => ['context-number', 'kept-line', 'number-mark'].includes(f.kind));
  // From the facts: 640 users (a metric), 9 hours (a baseline), 4 people (the team): nothing flagged.
  expect(flagged(resume('Engineer who builds dispatch software.', ['Build the dispatch console for 640 users across 12 depots.', 'Cut the nightly billing run from 9 hours to 40 minutes with a team of about 4 people.']))).toEqual([]);
  // 35 stands only in the project's situation.
  const depots = flagged(resume('Engineer who builds dispatch software.', ['Build the dispatch console that replaced paper planning in 35 depots.']));
  expect(depots.map((f) => [f.kind, f.severity, f.items])).toEqual([['context-number', 'high', ['35']]]);
  expect(depots[0].text).toBe('“Build the dispatch console that replaced paper planning in 35 depots.” uses 35, which your record has only in a project’s background, not in a fact. Take it out, or use a number a fact states.');
  // A kept line is no context for numbers (the writer is sent it as "in [number] of [number] roles"): only a copy is caught.
  expect(flagged(resume('Engineer who led teams in 2 of 3 roles.', ['Build the dispatch console for 640 users.']))).toEqual([]);
  const copied = flagged(resume('Your record shows you managing, hiring or growing a team in 2 of 3 roles.', ['Build the dispatch console for 640 users.']));
  expect(copied.map((f) => f.kind)).toEqual(['kept-line']);
  // A resume that prints the mark is flagged, by exact match.
  const marked = flagged(resume('Engineer who builds dispatch software.', ['Replaced paper planning in [number] depots.']));
  expect(marked.map((f) => [f.kind, f.severity])).toEqual([['number-mark', 'high']]);
  // All three are for the writer to put right.
  expect(fixable(resume('Your record shows you managing, hiring or growing a team in 2 of 3 roles.', ['Build the console for 35 depots.', 'Ran [number] depots.']), 2).length).toBe(3);
});

test('a number from a project\'s background is sent back to the writer and taken out', async () => {
  noLinks();
  withProjects();
  const bad = WRITTEN.replace('- Build the dispatch console that 640 users across 12 depots open every day.', '- Build the dispatch console that replaced paper planning in 35 depots.');
  const good = WRITTEN;
  calls = [];
  fakeAsk((c) => {
    calls.push(c);
    const k = kind(c);
    if (k === 'write') return { resume: bad, changes: [], questions: [] };
    if (k === 'glance') return answered(true);
    if (k === 'fix') return { resume: good, changes: ['Took out a number that no fact states.'] };
    return { score: 9, note: 'Clear.', problems: [] };
  });
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance', 'fix', 'glance']);
  expect(calls.find((x) => kind(x) === 'fix')!.prompt).toContain('uses 35, which your record has only in a project’s background');
  expect(c.resume).not.toContain('35 depots');
});

// ---------- Stage 3 review ----------

// The facts the bank sent before projects of roles reached it (the rule at commit a32e6ce): every fact of an employer's
// rows and of the rows filed under them, and General (no role, or a role that is gone).
function keysBefore(): string[] {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const ids = new Set(employers(roles).flatMap((g) => [...g.rows, ...g.children].map((r) => r.id)));
  return (db.query('SELECT id, role_id FROM facts ORDER BY id').all() as { id: number; role_id: number | null }[])
    .filter((f) => f.role_id === null || ids.has(f.role_id) || !roles.some((r) => r.id === f.role_id)).map((f) => `fact:${f.id}`).sort();
}
const keysNow = () => (JSON.stringify(bank()).match(/"key":"fact:\d+"/g) ?? []).map((k) => k.slice(7, -1)).sort();

test('every fact the bank sent before is sent, once, however roles, projects and repositories are arranged', () => {
  const same = (step: string) => { const now = keysNow(); expect([step, new Set(now).size === now.length, now]).toEqual([step, true, keysBefore()]); };
  same('a plain role');
  const role = (addRole({ title: 'Platform Contractor', company: 'Fernway', start: '2015-01', end: '2015-12' }) as { id: number }).id;
  const p = (addProject({ title: 'Fernway migration', roleId: role, when: '2015', situation: 'A move of 40 services.' }) as { id: number }).id;
  addFact({ projectId: String(p), text: 'Moved Fernway to the new cloud.', metric: '40 services' });
  addFact({ roleId: role, text: 'Ran Fernway on-call.' });
  same('a role with a project');
  expect(patchRole(role, { standing: '', reach: '', partOf: 1 }).ok).toBe(true);
  same('that role made part of another employer');
  expect(keysNow()).toContain(`fact:${idOf('Moved Fernway to the new cloud.')}`);
  db.run("INSERT INTO roles (id, company, title, part_of) VALUES (90, 'harborlight/dispatch', '', 1)");
  fact(90, 'Wrote the dispatch repository.');
  same('a repository filed under an employer');
  db.run("INSERT INTO roles (id, company, title, start, end, standing) VALUES (91, 'lantern-notes', '', '2022-05', '2023-01', 'personal')");
  fact(91, 'Built a notes app.');
  same('a side project');
  db.run("INSERT INTO roles (id, company, title, standing) VALUES (92, 'avery/sketchbook', '', '')");
  fact(92, 'Drew a sketch a day.');
  same('an unplaced repository');
  fact(null, 'Speaks at meetups.');
  same('General');
  const own = (addProject({ title: 'Dispatch console', roleId: 1 }) as { id: number }).id;
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(own, idOf('Built the dispatch console that schedulers use every day.'));
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(own, idOf('Rebuilt the quoting API.'));
  same('a fact whose project is a project of another role');
});

test('a line of How you work about what was learned never reaches the resume writer', async () => {
  for (let i = 0; i < 4; i++) {
    const p = project(1, `Project ${i}`, { learned: 'I learned to ship small changes often.' });
    fileIn(fact(1, `Shipped invented change ${i}.`), p);
  }
  const learned = derivedNow().find((l) => l.key.startsWith('learned:'))!;
  expect(judge(derivedNow(), learned.key, 'kept', 2)).toBe('');
  expect(keptLines().map((l) => l.key)).toContain(learned.key);
  model();
  await compose(POSTING, 2, TERMS, REQS);
  expect(writePrompt()).not.toContain('ship small changes');
});

test('a requirement backed by a project weighs as its role does, and the fit of an unchanged record is unchanged', () => {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const fit = fitOf(weigh(REQS, roles, Date.UTC(2026, 10, 17)));
  const p = project(1, 'Dispatch console');
  fileIn(idOf('Built the dispatch console that schedulers use every day.'), p);
  expect(fitOf(weigh(REQS, roles, Date.UTC(2026, 10, 17)))).toBe(fit);
  const req: Requirement = { text: 'Dispatch software', need: 'must', coverage: 'strong', evidence: '', roles: ['role:1'] };
  const [byRole] = weigh([req], roles, Date.UTC(2026, 10, 17)), [byProject] = weigh([{ ...req, roles: [`project:${p}`] }], roles, Date.UTC(2026, 10, 17));
  expect([byProject.weight, byProject.basis]).toEqual([byRole.weight, byRole.basis]);
  expect(byRole.weight).toBeGreaterThan(0.8);
});

test('the writer is told that a requirement\'s best evidence is never a project, once the bank sends one', async () => {
  const line = '"best" is never a project ("project:3"): name the project\'s strongest fact instead.';
  model();
  await compose(POSTING, 2, TERMS, REQS);
  expect(writePrompt()).not.toContain(line);
  withProjects();
  model();
  await compose(POSTING, 2, TERMS, REQS);
  expect(writePrompt()).toContain(line);
});

test('the skim\'s fix is told what a project is, when a resume is written and when it is reviewed', async () => {
  withProjects();
  model(WRITTEN, answered(false));
  await compose(POSTING, 2, TERMS, REQS);
  expect(calls.filter((c) => kind(c) === 'fix').every((c) => c.prompt.includes(CONTEXT))).toBe(true);
  delete process.env.EGG_COUNCIL;
  const id = job(WRITTEN);
  model(WRITTEN, answered(false));
  await review(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow, false);
  const fixes = calls.filter((c) => kind(c) === 'fix');
  expect(fixes.length).toBeGreaterThan(0);
  expect(fixes.every((c) => c.prompt.includes(CONTEXT))).toBe(true);
});

test('a project written as a heading of its own is named as a project, sent back to the writer, and still never kept', () => {
  project(1, 'Dispatch console');
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const page = (sub: string) => `# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n${sub}\n- Built the console.\n\n## Skills\nGo\n`;
  for (const sub of ['#### Dispatch console', '**Dispatch console** (2022 – 2023)']) {
    const found = checkEntries(page(sub), roles, projectNames());
    expect(found.map((f) => f.text)).toEqual([expect.stringContaining('It is a project of Director of Engineering at Harborlight Systems in your record: its facts are bullets of that role, never an entry or a heading with dates of its own.')]);
    // What is accepted or refused is the same: the version is not kept.
    expect(repairEntries(page(sub), roles, projectNames()).unresolved.length).toBe(1);
    expect(codeFlags(page(sub), 2).filter((f) => f.kind === 'project-heading').length).toBe(1);
    expect(fixable(page(sub), 2).some((t) => t.includes('It is a project of'))).toBe(true);
  }
  // A heading that is no project keeps the old words.
  expect(checkEntries(page('#### Lantern Notes'), roles, projectNames()).map((f) => f.text)).toEqual(['The resume has an entry “Lantern Notes”. Your record has no job or project by that name, or with that title and those dates.']);
  expect(CONTEXT).toContain('A project is never a heading or a sub-heading of its own, and never has dates of its own: its facts are bullets of its role.');
});

// ---------- Numbers no fact holds are left out of what the writer is given ----------

test('a number no fact of the project holds is sent as [number]; one it holds stays; the bullet that uses a fact\'s value is quiet', async () => {
  const console = project(1, 'Dispatch console', { situation: 'Schedulers planned 35 depots on paper.', result: 'The console reached 640 users in 12 depots.' });
  fileIn(idOf('Built the dispatch console that schedulers use every day.'), console);
  fact(1, 'Cut support calls.', '35% fewer calls');
  model();
  await compose(POSTING, 2, TERMS, REQS);
  const prompt = writePrompt(), harbor = bankOf(prompt).entries.find((e: { heading: string }) => e.heading.includes('Harborlight')).roles[0];
  expect(harbor.projects[0].context).toEqual({ situation: 'Schedulers planned [number] depots on paper.', result: 'The console reached 640 users in 12 depots.' });
  expect(prompt).not.toContain('35 depots');
  expect(prompt).toContain('"[number]" stands where a number was left out because no fact holds it. Never print "[number]", and never put a number of your own in its place.');
  // 35 stands in a fact of the employer ("35% fewer calls"), so a bullet with it is not flagged: the writer never saw "35 depots".
  const page = `# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Rolled the console out to 35 depots.\n`;
  expect(codeFlags(page, 2).filter((f) => f.kind === 'context-number')).toEqual([]);
  // The stored text is as the person wrote it.
  expect(db.query('SELECT situation FROM projects WHERE id = ?').get(console)).toEqual({ situation: 'Schedulers planned 35 depots on paper.' });
});

test('true numbers written another way are quiet; a number from another employer\'s project is caught', () => {
  const quoting = project(2, 'Quoting', { situation: 'Quotes went to 35 depots by fax, in 3 parts.' });
  fileIn(idOf('Rebuilt the quoting API.'), quoting);
  fact(2, 'Led 3 junior engineers through the rewrite.');
  fact(1, 'Managed a team of 5 engineers.');
  expect(judge(derivedNow(), 'led', 'kept', 2)).toBe('');
  db.run("UPDATE facts SET text = 'Cut the nightly billing run from 6 hours to 40 minutes.' WHERE text = 'Cut the nightly billing run.'");
  const page = (harbor: string[], quill: string[]) => `# Avery Lindqvist\n\n## Summary\nEngineer with 12 years in logistics.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n${harbor.map((b) => `- ${b}`).join('\n')}\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n${quill.map((b) => `- ${b}`).join('\n')}\n`;
  const flagged = (text: string) => codeFlags(text, 2).filter((f) => f.kind === 'context-number').map((f) => f.items);
  expect(flagged(page(['Cut the nightly billing run from 6 hrs to 40 min.', 'Built a dispatch console for 640 daily users across 12 depots.'], ['Led 3 engineers through the quoting rewrite.', 'Led a team of 3 through the rewrite.']))).toEqual([]);
  // 35 stands in Quillfeather's project and in no fact of Harborlight: copied across employers, it is caught.
  expect(flagged(page(['Rolled the console out to 35 depots.'], ['Rebuilt the quoting API.']))).toEqual([['35']]);
});

test('a resume that prints [number] is sent back to the writer and put right', async () => {
  noLinks();
  withProjects();
  const marked = WRITTEN.replace('- Build the dispatch console that 640 users across 12 depots open every day.', '- Build the dispatch console that replaced paper planning in [number] depots.');
  calls = [];
  fakeAsk((c) => {
    calls.push(c);
    const k = kind(c);
    if (k === 'write') return { resume: marked, changes: [], questions: [] };
    if (k === 'glance') return answered(true);
    if (k === 'fix') return { resume: WRITTEN, changes: ['Took out the mark.'] };
    return { score: 9, note: 'Clear.', problems: [] };
  });
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance', 'fix', 'glance']);
  expect(calls.find((x) => kind(x) === 'fix')!.prompt).toContain('prints “[number]”');
  expect(c.resume).not.toContain('[number]');
});

test('a number with no noun, "go 9 weeks" and "35/45" are taken out of what the writer is sent, and copies of them are caught', async () => {
  const hosting = project(1, 'Hosting', { situation: '20% of drivers quit each year. Releases would go 9 weeks apart. We reached 35/45 depots.', did: 'Took 12 of the depots live.' });
  fileIn(fact(1, 'Cut hosting costs by 20%.', '20% lower hosting costs'), hosting);
  fileIn(fact(1, 'Brought 12 depots onto the console.', 'team of 12'), hosting);
  let prompt = '';
  fakeAsk((c) => { prompt = c.prompt; return { title: 'Staff Engineer', company: 'Nimbus Yard', place: '', verdict: 'v', strengths: [], risks: [], gaps: [], knockouts: [], checks: [], terms: [], requirements: [] }; });
  await assess(POSTING);
  const context = (JSON.parse(prompt.slice(prompt.indexOf('The bank, as JSON:\n') + 19)).entries[0].roles[0].projects[0]).context;
  expect(context).toEqual({ situation: '[number] of drivers quit each year. Releases would go [number] weeks apart. We reached [number]/[number] depots.', what_i_did: 'Took [number] of the depots live.' });
  for (const hidden of ['20% of drivers', 'go 9 weeks', '35/45', '12 of the depots']) expect([hidden, prompt.includes(hidden)]).toEqual([hidden, false]);
  const page = (b: string) => `# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- ${b}\n`;
  const flagged = (b: string) => codeFlags(page(b), 2).filter((f) => f.kind === 'context-number').map((f) => f.items);
  expect(flagged('Shipped every 9 weeks.')).toEqual([['9']]);
  expect(flagged('Rolled out to 35 of 45 depots.')).toEqual([['35', '45']]);
  // 20 and 12 stand in facts of the employer: quiet by the check, and the writer never saw them in the background.
  expect([flagged('Cut driver attrition 20%.'), flagged('Took 12 depots live.')]).toEqual([[], []]);
});

test('a project\'s parts are refused past 4,000 characters, in words, and never cut', () => {
  const long = 'x'.repeat(4001);
  for (const part of ['situation', 'did', 'result', 'learned']) {
    const made = addProject({ title: `Long ${part}`, roleId: 1, [part]: long });
    expect([part, made.ok]).toEqual([part, false]);
    expect((made as { error: string }).error).toMatch(/at most 4,000 characters/);
  }
  const p = (addProject({ title: 'Short parts', roleId: 1, situation: 'x'.repeat(4000) }) as { id: number }).id;
  const edit = patchProject(p, { result: long });
  expect(edit.ok).toBe(false);
  expect(db.query('SELECT situation, result FROM projects WHERE id = ?').get(p)).toEqual({ situation: 'x'.repeat(4000), result: '' });
});

test('a number that ends a clause in the background is not sent because a fact ends on the same number', async () => {
  const p = project(1, 'Hosting', { situation: 'Attrition fell 20%. Depots by city: Dallas 12, Austin 9, Denver 14.' });
  fileIn(fact(1, 'Cut hosting costs by 20%.'), p);
  let prompt = '';
  fakeAsk((c) => { prompt = c.prompt; return { title: 'Staff Engineer', company: 'Nimbus Yard', place: '', verdict: 'v', strengths: [], risks: [], gaps: [], knockouts: [], checks: [], terms: [], requirements: [] }; });
  await assess(POSTING);
  const context = JSON.parse(prompt.slice(prompt.indexOf('The bank, as JSON:\n') + 19)).entries[0].roles[0].projects[0].context;
  expect(context).toEqual({ situation: 'Attrition fell [number]. Depots by city: Dallas [number], Austin [number], Denver [number].' });
  for (const hidden of ['fell 20%', 'Denver 14', 'Austin 9']) expect([hidden, prompt.includes(hidden)]).toEqual([hidden, false]);
  // 14 stands in the background and in no fact of Harborlight: a bullet with it is caught.
  const page = `# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Opened 14 depots in Denver.\n`;
  expect(codeFlags(page, 2).filter((f) => f.kind === 'context-number').map((f) => f.items)).toEqual([['14']]);
});
