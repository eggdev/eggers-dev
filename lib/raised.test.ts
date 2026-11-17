// `bun test lib`: the questions code raises for the person (lib/raised.ts), on a scratch database
// (lib/scratch.ts). The same finding is asked once, an answered question stays answered, and the list
// the person sees (openQuestions in lib/talk.ts) includes them.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, fact, reset, role } from './scratch.ts';
import { codeFlags, syncQuestions } from './checks.ts';
import { answer, ANSWER_HOLD_MS, lastAnswerAt, openRaised, raise, raisedByKey, rewriteDue } from './raised.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { storePositions } from './linkedin.ts';
import { markSkills, syncSkills } from './skills.ts';
import { openQuestions, prune, reply, say, type TalkRow } from './talk.ts';

beforeEach(reset);
afterEach(() => fakeAsk());
const two = [{ key: 'demo:1', text: 'Is the first thing right?', choices: ['Yes', 'No'], about: 'role:1' }, { key: 'demo:2', text: 'Is the second thing right?' }];

test('the same finding is never asked twice', () => {
  raise('demo', two, 100);
  raise('demo', two, 200);
  raise('demo', [{ ...two[0], text: 'Is the first thing still right?' }, two[1]], 300);
  expect(openRaised().map((q) => [q.key, q.text, q.raisedAt])).toEqual([['demo:1', 'Is the first thing still right?', 100], ['demo:2', 'Is the second thing right?', 100]]);
  expect((db.query('SELECT count(*) AS n FROM raised_questions').get() as { n: number }).n).toBe(2);
});

test('an answered question stays answered, however often it is found again', () => {
  raise('demo', two, 100);
  expect(answer('demo:1', 5, '', 150)).toBe('Choose one of the listed answers.');
  expect(answer('demo:1', 1, '', 150)).toBe('');
  expect(raisedByKey('demo:1')).toMatchObject({ answeredAt: 150, answer: 'No' });
  raise('demo', two, 200);
  raise('demo', [{ ...two[0], text: 'Asked in other words?' }], 300);
  expect(openRaised().map((q) => q.key)).toEqual([]);
  expect(raisedByKey('demo:1')).toMatchObject({ answeredAt: 150, answer: 'No', text: 'Is the first thing right?' });
  expect(answer('demo:9', 0, '', 400)).toBe('That question is no longer open.');
});

test('a finding that is gone is not asked, and comes back if it is found again unanswered', () => {
  raise('demo', two, 100);
  raise('demo', [two[1]], 200);
  expect(openRaised().map((q) => q.key)).toEqual(['demo:2']);
  raise('other', [{ key: 'other:1', text: 'Another kind?' }], 250);
  expect(openRaised().map((q) => q.key)).toEqual(['demo:2', 'other:1']);
  raise('demo', two, 300);
  expect(openRaised().map((q) => q.key)).toEqual(['demo:1', 'demo:2', 'other:1']);
});

test('Talk does not list them, and nothing Talk records can close one', () => {
  raise('timeline', [two[0]], 100);
  db.run(`UPDATE profile SET gaps = 'What did the console replace?' WHERE id = 1`);
  expect(openQuestions().map((q) => [q.text, q.from])).toEqual([['What did the console replace?', 'From your profile']]);
  // Its wording in Talk's own table of answered questions changes nothing: only answer() closes it.
  db.query('INSERT INTO answered (question, at) VALUES (?, ?)').run('Is the first thing right?', 200);
  expect(openRaised().map((q) => q.key)).toEqual(['demo:1']);
  expect(answer('demo:1', 0, '', 300)).toBe('');
  expect(openRaised()).toEqual([]);
});

test('an answer is applied once, to a question that is still live, with one short line at most', () => {
  raise('demo', two, 100);
  expect(answer('demo:1', 0, 'x'.repeat(201), 150)).toBe('Keep what you write to one line of at most 200 characters.');
  expect(answer('demo:1', 0, 'two\nlines', 150)).toBe('Keep what you write to one line of at most 200 characters.');
  expect(answer('demo:1', 0, '', 150)).toBe('');
  expect(answer('demo:1', 1, '', 160)).toBe('That question is already answered.');
  expect(raisedByKey('demo:1')).toMatchObject({ answeredAt: 150, answer: 'Yes' });
  // The finding is gone: there is nothing left to answer.
  raise('demo', [], 200);
  expect(answer('demo:2', 0, '', 250)).toBe('That question is no longer open.');
  expect(raisedByKey('demo:2')!.answeredAt).toBe(0);
});

test('the worker waits 15 minutes after the last answer before it writes resumes again', () => {
  const MIN = 60_000, QUIET = 3 * MIN, t0 = 1_000_000_000;
  expect(ANSWER_HOLD_MS).toBe(15 * MIN);
  // No answer yet: the bank being still for the quiet time is enough, as before.
  expect(rewriteDue(t0 + QUIET - 1, t0, QUIET, 0)).toBe(false);
  expect(rewriteDue(t0 + QUIET, t0, QUIET, 0)).toBe(true);
  // Five answers a few minutes apart, each changing the bank: nothing is queued until 15 minutes after the last.
  const answers = [0, 4, 8, 12, 16].map((m) => t0 + m * MIN);
  const queuedAt: number[] = [];
  let since = t0, last = 0, queued = false;
  for (let now = t0; now <= t0 + 60 * MIN; now += MIN) {
    if (answers.includes(now)) { since = now; last = now; queued = false; }
    if (!queued && rewriteDue(now, since, QUIET, last)) { queued = true; queuedAt.push(now); }
  }
  expect(queuedAt).toEqual([t0 + 31 * MIN]);
  // The last answer is read from the table.
  raise('demo', two, 100);
  expect(lastAnswerAt()).toBe(0);
  answer('demo:1', 0, '', 700);
  answer('demo:2', 0, '', 900);
  expect(lastAnswerAt()).toBe(900);
});

test('a timeline question is raised from the roles, and its answer changes the role', () => {
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Lantern Notes', title: 'Founder', start: '2023-06', standing: 'own' });
  role({ id: 3, company: 'Quillfeather Labs', title: 'Engineer', start: '2018-01', end: '2021-09' });
  const now = new Date(2026, 10, 16).getTime(); // the overlap is measured up to today for a current job
  syncQuestions(now);
  syncQuestions(now + 1);
  expect(openRaised().map((q) => [q.key, q.about])).toEqual([['overlap:3:1', 'role:3,role:1'], ['two-current:1:2', 'role:1,role:2']]);
  // The note needs a line of text, and an end date a month.
  expect(answer('two-current:1:2', 2, '', now + 2)).toMatch(/Write one line/);
  expect(answer('two-current:1:2', 0, 'last spring', now + 2)).toMatch(/year and a month/);
  // The same rule as PATCH /roles/:id: a job cannot end before it starts.
  expect(answer('two-current:1:2', 0, '2020-12', now + 2)).toBe('That end date is before the job’s start date.');
  expect((db.query('SELECT end FROM roles WHERE id = 1').get() as { end: string }).end).toBe('');
  expect(answer('two-current:1:2', 2, 'My own studio, run on weekends beside the Harborlight job.', now + 2)).toBe('');
  expect((db.query('SELECT note FROM roles WHERE id = 2').get() as { note: string }).note).toBe('My own studio, run on weekends beside the Harborlight job.');
  expect(answer('overlap:3:1', 2, '', now + 2)).toBe('');
  expect((db.query('SELECT label FROM roles WHERE id = 3').get() as { label: string }).label).toBe('Part-time');
  syncQuestions(now + 3);
  expect(openRaised()).toEqual([]);
  // Taking the note away brings the finding back, but the person already answered it: it is not asked again.
  db.run("UPDATE roles SET note = '' WHERE id = 2");
  syncQuestions(now + 4);
  expect(openRaised()).toEqual([]);
  // It is still a flag on a resume that shows both jobs, and the flag no longer says a question is waiting.
  const resume = '# Avery Lindqvist\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the console.\n\n### Founder, Lantern Notes\nJun 2023 – Present\n- Run the studio.\n';
  const flag = codeFlags(resume, 2, now).filter((f) => f.kind === 'timeline').map((f) => f.text);
  expect(flag).toEqual(['Director of Engineering at Harborlight Systems and Founder at Lantern Notes both say Present, and nothing on the resume explains how they relate. Give the job an end date, a label or a one-line note to settle it.']);
  // A resume that shows neither job carries no such flag.
  expect(codeFlags('# Avery Lindqvist\n\n## Experience\n### Engineer, Quillfeather Labs\nJan 2018 – Sep 2021 · Part-time\n- Rebuilt the API.\n', 2, now).filter((f) => f.kind === 'timeline')).toEqual([]);
});

test('a Talk reply and a prune never close a timeline, LinkedIn or skill question', async () => {
  const now = new Date(2026, 10, 16).getTime();
  // One question of each kind: two current jobs, a title that differs from LinkedIn, and a skill gained after the review.
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Lantern Notes', title: 'Founder', start: '2023-06', standing: 'own' });
  fact(1, 'Built the console.', '', 'Go');
  syncSkills(now);
  expect(markSkills([{ name: 'Go', mark: 'confident' }], true, now + 1)).toEqual({ marked: 1 });
  fact(1, 'Moved the queue.', '', 'Redis');
  storePositions('## Positions.csv\nCompany Name,Title,Started On,Finished On\nHarborlight Systems,Head of Engineering,Mar 2021,\nLantern Notes,Founder,Jun 2023,\n', 1, now + 2);
  syncQuestions(now + 3);
  const raised = openRaised();
  expect(raised.map((q) => q.kind).sort()).toEqual(['linkedin', 'skill', 'timeline']);
  db.run(`UPDATE profile SET gaps = 'What did the console replace?' WHERE id = 1`);
  // The model claims every question is answered, the raised ones word for word among them.
  const everything = [...raised.map((q) => q.text), 'What did the console replace?'];
  const prompts: string[] = [];
  fakeAsk((c: Ask) => { prompts.push(c.prompt); return c.prompt.startsWith('You are talking with one person') ? { reply: 'Noted.', facts: [], answered: everything } : { answered: everything, repeats: everything }; });
  expect(say('Lantern Notes is my own studio, and my title is Head of Engineering, and yes to Redis.', now + 4)).toBe('');
  await reply(db.query("SELECT * FROM talk WHERE status = 'queued'").get() as TalkRow, '/tmp');
  expect(openQuestions()).toEqual([]);
  db.run(`UPDATE profile SET gaps = 'Who used the console each day?' WHERE id = 1`);
  everything.push('Who used the console each day?');
  // Its one question is named twice by the model (as answered and as a repeat). No raised question is counted.
  expect(await prune('/tmp')).toBe(2);
  // Talk closed its own two questions, and was never shown the raised ones.
  expect(openQuestions()).toEqual([]);
  for (const p of prompts) for (const q of raised) expect(p.includes(q.text)).toBe(false);
  // The raised ones are all still open, with nothing applied: no note, no title change, no mark.
  syncQuestions(now + 5);
  expect(openRaised().map((q) => q.key)).toEqual(raised.map((q) => q.key));
  expect(db.query('SELECT note, title FROM roles ORDER BY id').all()).toEqual([{ note: '', title: 'Director of Engineering' }, { note: '', title: 'Founder' }]);
  expect(db.query("SELECT mark FROM skills WHERE key = 'redis'").get()).toEqual({ mark: '' });
  // Each closes only by its own answer, which does what it says.
  expect(answer(raised.find((q) => q.kind === 'skill')!.key, 0, '', now + 6)).toBe('');
  expect(answer(raised.find((q) => q.kind === 'linkedin')!.key, 1, '', now + 6)).toBe('');
  expect(answer(raised.find((q) => q.kind === 'timeline')!.key, 2, 'My own studio, run on weekends.', now + 6)).toBe('');
  syncQuestions(now + 7);
  expect(openRaised()).toEqual([]);
  expect(db.query('SELECT note, title FROM roles ORDER BY id').all()).toEqual([{ note: '', title: 'Head of Engineering' }, { note: 'My own studio, run on weekends.', title: 'Founder' }]);
  expect(db.query("SELECT mark FROM skills WHERE key = 'redis'").get()).toEqual({ mark: 'confident' });
});
