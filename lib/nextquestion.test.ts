// `bun test lib`: the next question (lib/nextquestion.ts). Only questions that ask for more story are ever asked, in a
// fixed order; an answer in words goes to Talk exactly as given and is queued for the worker to learn from; an answered
// or skipped question is never asked again. On a scratch database; every person and employer is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, role, seed } from './scratch.ts';
import { syncRecordQuestions } from './gaps.ts';
import { raise } from './raised.ts';
import { fakeAsk } from './llm.ts';
import { originsOf, checkOrigin } from './origins.ts';
import { openQuestions, reply, type TalkRow } from './talk.ts';
import { answerText, candidates, drainAnswer, waitingAnswers, DOUBT, doubts, next, skip, TALK_SOURCES } from './nextquestion.ts';
import { keyOf } from './queue.ts';

const now = 1_800_000_000_000;
// Each of the invented person's jobs has a story told in full, so only what a test adds raises a record question.
beforeEach(() => {
  seed();
  for (const r of [1, 2, 3]) db.query("INSERT INTO projects (role_id, title, context, action, result, created_at) VALUES (?, 'An invented story', 'A setting.', 'I did it.', 'It changed.', 1)").run(r);
});
// Questions of every kind code raises that must never be asked here: two current jobs, a title that differs from
// LinkedIn, a skill, a short job.
const banned = () => {
  raise('timeline', [{ key: 'two-current:1:2', text: 'Harborlight Systems and Quillfeather Labs both say Present. Which is it?', choices: ['A', 'B'], about: 'role:1,role:2' }], now);
  raise('linkedin', [{ key: 'linkedin:title:1', text: 'LinkedIn calls this job Head of Engineering. Which title is right?', choices: ['Mine', 'LinkedIn'] }], now);
  raise('skill', [{ key: 'skill:rust', text: 'Rust is new on your record. Mark it?', choices: ['Confident', 'Not confident'] }], now);
  raise('timeline', [{ key: 'short:3', text: 'Support Lead lasted two years. How should resumes show it?', choices: ['As it is'] }], now);
};
const agenda = (key: string, count: number, term: string) => raise('agenda', [{ key, text: `${count} postings you saved ask for ${term}, and your record has no story that shows it. Tell one time you worked with it, or say you have not.`, data: { kind: 'term', term, jobs: [1, 2], count } }], now);
const unsentJobWithGaps = (gaps: string[]) => db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, outcome) VALUES ('A posting.', 'Staff Engineer', 'Initech', 'done', ?, 1, '')").run(JSON.stringify({ gaps }));
const talk = () => db.query('SELECT who, body, status FROM talk ORDER BY id').all();

test('only questions that ask for story are asked: never a date, two roles, a LinkedIn title, a skill or where a repository belongs', () => {
  banned();
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  syncRecordQuestions(now);
  const keys = candidates().map((c) => c.key);
  expect(keys).toEqual(['record:empty:4']);
  for (const k of ['two-current:1:2', 'linkedin:title:1', 'skill:rust', 'short:3', 'record:start:4', 'record:place:5']) expect(keys).not.toContain(k);
});

test('the order: the agenda by postings, then the record in its own order, then the questions a model wrote', () => {
  banned();
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2024-01' });
  const p = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Rebuilt dispatch', 1) RETURNING id").get() as { id: number }).id;
  syncRecordQuestions(now);
  raise('agenda', [
    { key: 'agenda:term:kafka', text: '2 postings you saved ask for Kafka, and your record has no story that shows it. Tell one time you worked with it, or say you have not.', data: { kind: 'term', term: 'Kafka', jobs: [1, 2], count: 2 } },
    { key: 'agenda:term:terraform', text: '4 postings you saved ask for Terraform, and your record has no story that shows it. Tell one time you worked with it, or say you have not.', data: { kind: 'term', term: 'Terraform', jobs: [1, 2, 3, 4], count: 4 } },
  ], now);
  unsentJobWithGaps(['How many depots used the console?']);
  const all = candidates();
  expect(all.map((c) => c.key.startsWith('talk:') ? 'talk' : c.key)).toEqual(['agenda:term:terraform', 'agenda:term:kafka', 'record:empty:4', `record:part:${p}:result`, 'talk']);
  expect(all.map((c) => c.from)).toEqual(['4 saved postings ask for this', '2 saved postings ask for this', 'From your record', 'From your record', 'For Staff Engineer at Initech']);
  expect(all.map((c) => c.input)).toEqual(['text', 'text', 'route', 'route', 'text']);
  // A record question carries what its screen needs to answer it the way it is answered on Home.
  expect(all[2]).toMatchObject({ choices: [], inputs: [], route: '/record/role/4' });
  expect(all[3]).toMatchObject({ choices: [], inputs: [], route: `/record/project/${p}` });
  expect(next()).toEqual({ question: all[0], open: 5 });
});

test('an answer goes to Talk exactly as written, closes the question, and is queued for the worker to learn from', async () => {
  agenda('agenda:term:kafka', 2, 'Kafka');
  const words = '  At Quillfeather I ran the quote events through Kafka — 3 topics, about 40k a day.  ';
  expect(answerText('agenda:term:kafka', words, now)).toBe('');
  const q = '2 postings you saved ask for Kafka, and your record has no story that shows it. Tell one time you worked with it, or say you have not.';
  // The question as the tool's turn (done: no model writes it), the owner's words as theirs, and one reply queued.
  expect(talk()).toEqual([{ who: 'claude', body: q, status: 'done' }, { who: 'you', body: words.trim(), status: 'done' }, { who: 'claude', body: '', status: 'queued' }]);
  // The worker's Talk loop takes only the queued reply.
  const work = db.query("SELECT * FROM talk WHERE status = 'queued' ORDER BY id").all() as TalkRow[];
  expect(work.length).toBe(1);
  expect(candidates()).toEqual([]);
  expect(db.query("SELECT answer FROM raised_questions WHERE key = 'agenda:term:kafka'").get()).toEqual({ answer: words.trim() });
  // Found again, it stays closed.
  agenda('agenda:term:kafka', 3, 'Kafka');
  expect(candidates()).toEqual([]);
  // The worker's reply records what was said as a fact, with the owner's words behind it.
  let prompt = '';
  fakeAsk((c) => { prompt = c.prompt; return { reply: 'Noted.', answered: [], facts: [{ roleKey: 'role:2', kind: 'accomplishment', text: 'Ran quote events through Kafka.', detail: '', metric: 'about 40k a day', skills: ['Kafka'], replaces: '', said: 'I ran the quote events through Kafka' }] }; });
  await reply(work[0], '/tmp');
  expect(prompt).toContain(`You: ${q}\n\nPerson: ${words.trim()}`);
  const f = db.query("SELECT id FROM facts WHERE text = 'Ran quote events through Kafka.'").get() as { id: number };
  const o = originsOf(f.id);
  expect(o.map((x) => ({ kind: x.kind, quote: x.quote }))).toEqual([{ kind: 'talk', quote: 'I ran the quote events through Kafka' }]);
  expect(checkOrigin(o[0]).state).toBe('holds');
});

test('a question a model wrote, answered here, is closed as Talk closes it', () => {
  unsentJobWithGaps(['How many depots used the console?']);
  const c = candidates()[0];
  expect(c.kind).toBe('talk');
  expect(answerText(c.key, 'Twelve depots.', now)).toBe('');
  expect(db.query('SELECT question FROM answered').all()).toEqual([{ question: 'How many depots used the console?' }]);
  expect(candidates()).toEqual([]);
});

test('two answers wait while Talk is busy and drain once each in order', () => {
  agenda('agenda:term:kafka', 2, 'Kafka');
  unsentJobWithGaps(['How did you use Redis?']);
  const first = candidates()[0], second = candidates()[1];
  db.query("INSERT INTO talk (who, status, created_at) VALUES ('claude', 'running', 1)").run();
  expect(answerText(first.key, 'We ran  two streams.\nBoth on Kafka.', now)).toBe('');
  expect(answerText(second.key, 'I wrote the Redis adapter.', now + 1)).toBe('');
  expect(candidates()).toEqual([]);
  expect(waitingAnswers()).toBe(2);
  expect(drainAnswer.immediate()).toBe(false);
  expect(talk()).toEqual([{ who: 'claude', body: '', status: 'running' }]);
  db.run("UPDATE talk SET status = 'done'");
  expect(drainAnswer.immediate()).toBe(true);
  expect(waitingAnswers()).toBe(1);
  expect(drainAnswer.immediate()).toBe(false);
  expect(talk().slice(1)).toEqual([
    { who: 'claude', body: first.text, status: 'done' },
    { who: 'you', body: 'We ran  two streams.\nBoth on Kafka.', status: 'done' },
    { who: 'claude', body: '', status: 'queued' },
  ]);
  db.run("UPDATE talk SET status = 'done'");
  expect(drainAnswer.immediate()).toBe(true);
  expect(waitingAnswers()).toBe(0);
  db.run("UPDATE talk SET status = 'done'");
  expect(drainAnswer.immediate()).toBe(false);
  expect(talk().slice(4)).toEqual([
    { who: 'claude', body: second.text, status: 'done' },
    { who: 'you', body: 'I wrote the Redis adapter.', status: 'done' },
    { who: 'claude', body: '', status: 'done' },
  ]);
});

test('an answer is refused when it is empty, the question is gone, or it is answered where it leads', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2024-01' });
  const p = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Rebuilt dispatch', 1) RETURNING id").get() as { id: number }).id;
  syncRecordQuestions(now);
  banned();
  expect(answerText('record:empty:4', '   ', now)).toBe('Write your answer, or skip the question.');
  expect(answerText(`record:part:${p}:result`, 'It worked.', now)).toBe('This question is answered where it leads.');
  expect(answerText('record:empty:4', 'A story.', now)).toBe('This question is answered where it leads.');
  // A raised question of a kind not asked here cannot be answered or skipped through it.
  expect(answerText('two-current:1:2', 'Both.', now)).toBe('That question is no longer open.');
  expect(skip('two-current:1:2', now)).toBe('That question is no longer open.');
  expect(db.query("SELECT answered_at FROM raised_questions WHERE key = 'two-current:1:2'").get()).toEqual({ answered_at: 0 });
  expect(talk()).toEqual([]);
});

test('a skipped question is closed with nothing in Talk, and never asked again', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2024-01' });
  syncRecordQuestions(now);
  agenda('agenda:term:kafka', 2, 'Kafka');
  unsentJobWithGaps(['How many depots used the console?']);
  for (const c of candidates()) expect(skip(c.key, now)).toBe('');
  expect(candidates()).toEqual([]);
  expect(talk()).toEqual([]);
  syncRecordQuestions(now + 1);
  agenda('agenda:term:kafka', 2, 'Kafka');
  expect(candidates()).toEqual([]);
  expect(next()).toEqual({ question: null, open: 0 });
});

// The owner's rule, kept for the questions a model wrote too: none that puts their own account in doubt is offered.
const DOUBTING = [
  'Can you confirm the dispatch console served 640 users?',
  'Please verify the dates of your Quillfeather role.',
  'Is it true that the billing run took six hours?',
  'Is it correct that you led six people?',
  'You started in March 2021; is that right?',
  'Which date is right for the move to Harborlight?',
  'Which one is correct: Director or Head of Engineering?',
  'Your Harborlight and Lantern Notes roles overlap. How?',
  'Were the overlapping roles both full time?',
  'Did you work at Quillfeather at the same time as Harborlight?',
  'There is a discrepancy between your resume and LinkedIn. Which holds?',
  'The team size looks inconsistent across your stories. What was it?',
  'Your end date should be corrected. When did you leave?',
];
const DEPTH = ['Tell one time you led a migration.', 'What did the team look like?', 'What was the number before?', 'Who used the console each day, and what changed for them?'];

test('a question a model wrote that puts the owner’s account in doubt is not offered, and is not closed', () => {
  for (const q of DOUBTING) expect(doubts(q)).toBe(true);
  for (const q of DEPTH) expect(doubts(q)).toBe(false);
  // Each pattern drops at least one sample, and a word only inside a longer word drops nothing.
  for (const re of DOUBT) expect(DOUBTING.some((q) => re.test(q))).toBe(true);
  expect(doubts('The unconfirmedly named overlapper project.')).toBe(false);
  unsentJobWithGaps(['Can you confirm the dispatch console served 640 users?', 'Your two current roles overlap. How?', 'What did the team look like?']);
  expect(candidates().map((c) => c.text)).toEqual(['What did the team look like?']);
  // Held back here only: Talk still lists them, and nothing is marked answered.
  expect(openQuestions().length).toBe(3);
  expect(db.query('SELECT count(*) AS n FROM answered').get()).toEqual({ n: 0 });
});

// The owner's rule held by where a question comes from, not by its words: the six-second skim and the council's review
// react to a resume ("Two current jobs?") and are never asked here, however they are worded.
test('a question from the skim or the review never reaches You, and cannot be answered or skipped there', () => {
  const skim = ['Is this a step down?', 'Two current jobs?', 'Why so many short roles?', 'Why is there a gap between 2012 and 2016?'];
  const review = ['What did the team look like at Quillfeather?'];
  db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, outcome) VALUES ('A posting.', 'Staff Engineer', 'Initech', 'done', ?, '# A resume', 1, '')")
    .run(JSON.stringify({ skim: { conclusion: '', questions: skim, open: [], top: [], revisions: 0, model: 'x', saw: '' }, review: { questions: review },
      questions: ['What did the billing run cost before?'], gaps: ['Tell one time you ran an on-call rota.'] }));
  db.run("UPDATE profile SET gaps = 'Who used the console each day?' WHERE id = 1");
  // Talk still lists every one of them, each with where it came from.
  expect(openQuestions().map((q) => [q.source, q.text])).toEqual([['resume', 'What did the billing run cost before?'], ['review', review[0]], ...skim.map((q) => ['skim', q]),
    ['profile', 'Who used the console each day?'], ['job', 'Tell one time you ran an on-call rota.']]);
  expect(candidates().map((c) => [c.from, c.text])).toEqual([['From writing your Initech resume', 'What did the billing run cost before?'], ['From your profile', 'Who used the console each day?'],
    ['For Staff Engineer at Initech', 'Tell one time you ran an on-call rota.']]);
  for (const q of [...skim, ...review]) {
    const key = `talk:${keyOf(q)}`;
    expect(answerText(key, 'Some words.', now)).toBe('That question is no longer open.');
    expect(skip(key, now)).toBe('That question is no longer open.');
  }
  expect(talk()).toEqual([]);
  expect(db.query('SELECT count(*) AS n FROM answered').get()).toEqual({ n: 0 });
  expect([...TALK_SOURCES].sort()).toEqual(['job', 'profile', 'resume']);
});
