// `bun test lib`: the six-second skim of rule 12, with a stand-in for the model (fakeAsk in lib/llm.ts). The
// loop stops at its cap, a clean skim costs one call, and what only the person can settle comes back as a
// question. The resume is invented. No database and no model.
import { afterEach, expect, test } from 'bun:test';
import { fakeAsk, type Ask } from './llm.ts';
import { MAX_REVISIONS, skimLoop, skimModel, type SkimContext } from './skim.ts';

afterEach(() => fakeAsk());

const RESUME = `# Avery Lindqvist
avery@lindqvist.example

## Summary
Engineer with 14 years in logistics software.

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present · Remote
- Build the dispatch console for 640 users.
- Cut the billing run from 6 hours to 40 minutes.
- A third bullet the skim must not see.

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021
- Rebuilt the quoting API.
`;
const context = (more: Partial<SkimContext> = {}): SkimContext => ({ top: [{ text: 'Go in production', evidence: 'Rebuilt the quoting API in Go.' }, { text: 'Leads delivery alone', evidence: '' }],
  posting: 'An invented posting.', bank: '{"entries":[]}', rules: 'RULES', cwd: '/tmp', ...more });
const isGlance = (c: Ask) => c.prompt.startsWith('You are a recruiter with six seconds');

test('the skim sees only the name, the summary and the first role with two bullets, on the cheapest model', async () => {
  const calls: Ask[] = [];
  fakeAsk((c) => { calls.push(c); return { conclusion: 'A hands-on engineering lead. Worth reading on.', misleading: '', questions: [], top: [{ requirement: 'x', answered: true, note: 'In the summary.' }, { requirement: 'y', answered: true, note: '' }] }; });
  const got = await skimLoop(RESUME, context());
  expect(calls.length).toBe(1);
  expect(calls[0].model).toBe('haiku');
  expect(skimModel()).toBe('haiku');
  const seen = calls[0].prompt.slice(calls[0].prompt.indexOf('<top-of-page>'));
  expect(seen).toContain('Name: Avery Lindqvist');
  expect(seen).toContain('First role: Director of Engineering, Harborlight Systems');
  expect(seen).toContain('- Cut the billing run from 6 hours to 40 minutes.');
  for (const hidden of ['A third bullet', 'Quillfeather', 'avery@lindqvist.example']) expect(calls[0].prompt).not.toContain(hidden);
  expect(calls[0].prompt).toContain('- Go in production\n- Leads delivery alone');
  expect(got.resume).toBe(RESUME);
  expect(got.skim).toMatchObject({ revisions: 0, open: [], questions: [], conclusion: 'A hands-on engineering lead. Worth reading on.' });
  // The answers are tied to the requirements as they were asked, by place.
  expect(got.skim.top).toEqual([{ requirement: 'Go in production', answered: true, note: 'In the summary.' }, { requirement: 'Leads delivery alone', answered: true, note: '' }]);
});

test('it rewrites and skims again while something can be fixed, and stops at the cap', async () => {
  let glances = 0, fixes = 0;
  fakeAsk((c) => {
    if (isGlance(c)) { glances++; return { conclusion: 'A manager, not a builder.', misleading: '', top: [{ requirement: '', answered: false, note: 'No Go is named.' }, { requirement: '', answered: true, note: '' }],
      questions: [{ question: 'Is this a step down?', who: 'writer' }, { question: 'Two current jobs?', who: 'person' }] }; }
    fixes++;
    expect(c.prompt).toContain('The top of the page does not answer this requirement: “Go in production”. No Go is named.');
    expect(c.prompt).toContain('- Go in production Evidence: Rebuilt the quoting API in Go.');
    return { resume: RESUME.replace('Engineer with 14 years', `Engineer, attempt ${fixes}, with 14 years`), changes: [`You now open on engineering (${fixes}).`] };
  });
  const tidied: string[] = [];
  const got = await skimLoop(RESUME, context({ tidy: (t) => { tidied.push(t); return `${t}\n`; } }));
  expect(MAX_REVISIONS).toBe(2);
  expect([glances, fixes]).toEqual([3, 2]);
  expect(tidied.length).toBe(2);
  expect(got.resume).toContain('attempt 2');
  expect(got.changes).toEqual(['You now open on engineering (1).', 'You now open on engineering (2).']);
  expect(got.skim.revisions).toBe(2);
  expect(got.skim.top.map((t) => t.answered)).toEqual([false, true]);
  // What the writer could not fix is kept as open; what only the person can settle is a question, never a guess.
  expect(got.skim.open.length).toBe(2);
  expect(got.skim.questions).toEqual(['Two current jobs?']);
  expect(got.skim.saw).toContain('attempt 2');
});

test('a question for the person alone starts no rewrite, and a code finding does', async () => {
  let fixes = 0;
  const clean = { conclusion: 'Clear.', misleading: '', questions: [{ question: 'Why two jobs at once?', who: 'person' }], top: [{ requirement: '', answered: true, note: '' }, { requirement: '', answered: true, note: '' }] };
  fakeAsk((c) => { if (isGlance(c)) return clean; fixes++; return { resume: `${RESUME}\nfixed`, changes: [] }; });
  const quiet = await skimLoop(RESUME, context());
  expect(fixes).toBe(0);
  expect(quiet.skim.questions).toEqual(['Why two jobs at once?']);
  const found = await skimLoop(RESUME, context({ found: (text) => (text.includes('fixed') ? [] : ['The summary runs to 5 sentences.']) }));
  expect(fixes).toBe(1);
  expect(found.skim).toMatchObject({ revisions: 1, open: [] });
});

test('a rewrite that comes back empty ends the loop with the resume as it was', async () => {
  fakeAsk((c) => (isGlance(c) ? { conclusion: '', misleading: 'It opens on a title the bullets do not bear out.', questions: [], top: [] } : { resume: '  ', changes: [] }));
  const got = await skimLoop(RESUME, context({ top: [] }));
  expect(got.resume).toBe(RESUME);
  expect(got.skim.open).toEqual(['The opening misleads: It opens on a title the bullets do not bear out.']);
});
