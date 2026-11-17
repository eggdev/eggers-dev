// `bun test lib`: writing a resume end to end, with a stand-in for every model call (fakeAsk in lib/llm.ts) and
// a scratch database of an invented person (lib/scratch.ts). No model, no browser, no real data.
// It covers: the posting map and the metrics inventory reach the writer; what a model changes in a title or a
// date is put back; no posting term is pasted into Skills; flags are stored; a hand edit is flagged, never rewritten.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { codeFlags } from './checks.ts';
import { assess, compose, FactsError, fitOf, keepEarlier, publish, refreshSkills, review, storeComposed, topRequirements, type Analysis, type JobRow, type Requirement } from './jobs.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { parseResume } from './resume.ts';
import { markSkills } from './skills.ts';

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
afterEach(() => { fakeAsk(); delete process.env.EGG_COUNCIL; delete process.env.EGG_SKIM; });

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
  expect(dropped.text).toBe('This resume shows 1 of the 3 measured results your bank holds for the jobs it gives bullets to. Left out: from 6 hours to 40 minutes; p95 latency 900 ms to 210 ms.');
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
    ['high', 'The resume gives the title “VP of Engineering” at Harborlight Systems. Your bank says “Director of Engineering”. A background check verifies titles.'],
    ['high', 'The resume gives the dates Jan 2014 – Feb 2021 for Senior Engineer, Quillfeather Labs. Your bank says Jan 2016 – Feb 2021.'],
    // An entry under another section is checked too. In the person's own edit it is a flag, and the text stays.
    ['high', 'The resume has an entry “Lantern Notes”. Your bank has no job or project by that name, or with that title and those dates.'],
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
