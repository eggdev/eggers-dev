// `bun test lib`: the record's questions for what it is missing (lib/gaps.ts): their order and wording, Home's cap of
// 7, at most 3 questions about baselines and own parts on a large record, "I don't know" kept closed, and that an
// answer writes exactly the one value its row names. On a scratch database; everything in it is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, role, seed } from './scratch.ts';
import { BEST_OPEN, HOME_RECORD, gapInput, recordGaps, syncRecordQuestions } from './gaps.ts';
import { answer, openRaised, raisedByKey, choiceAt } from './raised.ts';
import { queue } from './queue.ts';
import { bankSignature } from './db.ts';

const now = 1_800_000_000_000;
const project = (roleId: number, title: string) => (db.query('INSERT INTO projects (role_id, title, created_at) VALUES (?, ?, 1) RETURNING id').get(roleId, title) as { id: number }).id;
// Each of the invented person's jobs has a story told in full, so only what a test adds raises a question.
beforeEach(() => {
  seed();
  for (const r of [1, 2, 3]) db.query("INSERT INTO projects (role_id, title, context, action, result, created_at) VALUES (?, 'An invented story', 'A setting.', 'I did it.', 'It changed.', 1)").run(r);
});
const open = () => openRaised().filter((q) => q.kind === 'record');
// An unsent job whose reading names these facts as its best evidence.
const leanOn = (...facts: number[]) => db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Initech', 'done', ?, '# A resume', 1, '')")
  .run(JSON.stringify({ requirements: facts.map((id) => ({ text: 'Something', need: 'must', coverage: 'strong', evidence: '', best: `fact:${id}` })) }));

test('each row is found, in the plan’s order, with its wording', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  fact(5, 'Drew a sketch a day.');
  const p = project(1, 'Rebuilt dispatch');
  db.run("UPDATE facts SET metric = '640 users' WHERE id = 1");
  leanOn(1);
  syncRecordQuestions(now);
  const qs = recordGaps(gapInput());
  expect(qs.map((q) => q.key)).toEqual(['record:place:5', 'record:start:4', 'record:empty:4', `record:part:${p}:result`, 'record:baseline:1', 'record:own:1']);
  expect(qs.map((q) => q.text)).toEqual([
    'Was avery/sketchbook work for one of your employers, or your own project?',
    'When did you start as Head of Platform at Fernway?',
    'Tell a story from Head of Platform at Fernway.',
    'What came of “Rebuilt dispatch”?',
    'Built the dispatch console that schedulers use every day. What was the number before?',
    'Built the dispatch console that schedulers use every day. What was your own part?']);
  // Newest role first, by when it was added: an answer to another question (a start date) cannot reorder them.
  expect(qs[0].choices).toEqual(['Done at Fernway', 'Done at Tessellate Freight', 'Done at Quillfeather Labs', 'Done at Harborlight Systems', 'My own side project']);
  expect(qs[1].choices).toEqual(['Give the month', 'I don’t remember']);
  expect(qs[2].choices).toEqual([]);
  expect(qs[4].choices).toEqual(['Give it', 'There was none', 'I don’t know']);
  // Home: a question with choices is answered there; one with none leads to its item.
  const items = queue(now).items.filter((i) => i.kind === 'record');
  expect(items.map((i) => [i.key, i.inputs, i.route])).toEqual([
    ['record:place:5', ['', '', '', '', ''], ''], ['record:start:4', ['month', ''], ''], ['record:empty:4', [], '/record/role/4'],
    [`record:part:${p}:result`, ['line', ''], ''], ['record:baseline:1', ['line', '', ''], ''], ['record:own:1', ['line', ''], '']]);
});

test('a fact that already says where its number started is not asked for a baseline', () => {
  db.run("UPDATE facts SET metric = 'from 6 hours to 40 minutes' WHERE id = 2");
  db.run("UPDATE facts SET metric = 'p95 latency 900 ms to 210 ms' WHERE id = 4");
  leanOn(2, 4);
  expect(recordGaps(gapInput()).map((q) => q.key)).toEqual(['record:own:2', 'record:own:4']);
});

test('Home takes at most 7 of the record’s questions, and 300 facts with no baseline give at most 3 such questions', () => {
  // A large record: 19 roles, most with no start date, 300 measured facts that an unsent job leans on.
  for (let r = 10; r < 26; r++) role({ id: r, company: `Invented Co ${r}`, title: 'Engineer', start: '' });
  const ids: number[] = [];
  for (let i = 0; i < 300; i++) ids.push(fact(10 + (i % 16), `Shipped invented thing ${i}.`, `${i + 10} users`));
  leanOn(...ids);
  for (let p = 0; p < 40; p++) db.query("INSERT INTO projects (role_id, title, created_at) VALUES (?, ?, 1)").run(10 + (p % 16), `Invented project ${p}`);
  syncRecordQuestions(now);
  const all = open();
  expect(all.filter((q) => /record:(baseline|own):/.test(q.key)).length).toBe(BEST_OPEN);
  const home = queue(now).items.filter((i) => i.kind === 'record');
  expect(home.length).toBe(HOME_RECORD);
  // In the rows' order: the roles with no start come first.
  expect(home.every((i) => i.key.startsWith('record:start:'))).toBe(true);
});

test('"I don’t know" is an answer: kept, and never asked again; the next part of the project is asked instead', () => {
  const p = project(1, 'Rebuilt dispatch');
  syncRecordQuestions(now);
  expect(answer(`record:part:${p}:result`, 1, '', now, choiceAt(`record:part:${p}:result`, 1))).toBe('');
  syncRecordQuestions(now + 1);
  expect(raisedByKey(`record:part:${p}:result`)).toMatchObject({ answeredAt: now, answer: 'I don’t know' });
  expect(open().map((q) => q.key)).toEqual([`record:part:${p}:action`]);
  expect(db.query('SELECT result, action FROM projects WHERE id = ?').get(p)).toEqual({ result: '', action: '' });
});

test('an answer writes exactly the one value its row names, and nothing else', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  fact(4, 'Moved every service to one cloud.');
  const p = project(1, 'Rebuilt dispatch');
  db.run("UPDATE facts SET metric = '640 users' WHERE id = 1");
  leanOn(1);
  syncRecordQuestions(now);
  const roles = () => db.query('SELECT * FROM roles ORDER BY id').all() as Record<string, unknown>[];
  const before = roles();
  expect(answer('record:start:4', 0, '2023-13', now, choiceAt('record:start:4', 0))).toBe('Give the start as a year and a month, like 2021-03.');
  expect(answer('record:start:4', 0, '2023-03', now, choiceAt('record:start:4', 0))).toBe('');
  expect(answer('record:place:5', 3, '', now, choiceAt('record:place:5', 3))).toBe('');
  const after = roles();
  expect(after.map((r, i) => Object.keys(r).filter((k) => r[k] !== before[i][k]))).toEqual([[], [], [], ['start'], ['part_of']]);
  expect(after[4].part_of).toBe(1);
  expect(answer(`record:part:${p}:result`, 0, '', now, choiceAt(`record:part:${p}:result`, 0))).toBe('Write it in one line.');
  expect(answer(`record:part:${p}:result`, 0, 'Schedulers stopped using paper.', now, choiceAt(`record:part:${p}:result`, 0))).toBe('');
  expect(db.query('SELECT result, action, context FROM projects WHERE id = ?').get(p)).toEqual({ result: 'Schedulers stopped using paper.', action: '', context: '' });
  const sig = bankSignature();
  expect(answer('record:baseline:1', 1, '', now, choiceAt('record:baseline:1', 1))).toBe('');
  // "There was none" is kept as the answer, and is not a value a resume's writer is given: the signature is unchanged.
  expect(bankSignature()).toBe(sig);
  expect(answer('record:own:1', 0, 'I designed the screens and wrote the front end.', now, choiceAt('record:own:1', 0))).toBe('');
  expect(db.query('SELECT baseline, own_part FROM facts WHERE id = 1').get()).toEqual({ baseline: 'There was none', own_part: 'I designed the screens and wrote the front end.' });
  // The own part is given to the writer (stage 3): the signature moves.
  expect(bankSignature()).not.toBe(sig);
  syncRecordQuestions(now + 1);
  expect(open().map((q) => q.key)).toEqual(['record:empty:4', `record:part:${p}:action`]);
});

test('placing a repository as the owner’s own makes it a side project', () => {
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  syncRecordQuestions(now);
  const q = raisedByKey('record:place:5')!;
  expect(answer('record:place:5', q.choices.length - 1, '', now, choiceAt('record:place:5', q.choices.length - 1))).toBe('');
  expect(db.query('SELECT standing, part_of FROM roles WHERE id = 5').get()).toEqual({ standing: 'personal', part_of: null });
  syncRecordQuestions(now + 1);
  expect(open().some((x) => x.key === 'record:place:5')).toBe(false);
});

// ---------- After the review of stage 2 ----------
test('a tap can never land on another choice: an answer whose words are no longer that choice is refused, and nothing is written', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  syncRecordQuestions(now);
  const seen = choiceAt('record:place:5', 0);
  expect(seen).toBe('Done at Fernway');
  // Another question is answered (a start date) and the record syncs: the place question's choices keep their order.
  expect(answer('record:start:4', 0, '2023-03', now, choiceAt('record:start:4', 0))).toBe('');
  syncRecordQuestions(now + 1);
  expect(choiceAt('record:place:5', 0)).toBe('Done at Fernway');
  // A role added since does change them: the answer the owner gave to what they saw is refused.
  role({ id: 6, company: 'Initech', title: 'Engineer', start: '2024-01' });
  syncRecordQuestions(now + 2);
  expect(choiceAt('record:place:5', 0)).toBe('Done at Initech');
  expect(answer('record:place:5', 0, '', now + 3, seen)).toBe('This question changed. Look at it again.');
  expect(answer('record:place:5', 0, '', now + 3)).toBe('Say which answer you chose, in its words.');
  expect(db.query('SELECT part_of, standing FROM roles WHERE id = 5').get()).toEqual({ part_of: null, standing: '' });
  expect(raisedByKey('record:place:5')!.answeredAt).toBe(0);
});

test('a sync that finds nothing new writes nothing, for the record’s questions and the older kinds', async () => {
  const { syncQuestions } = await import('./checks.ts');
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2023-01' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  db.run("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Rebuilt dispatch', 1)");
  syncQuestions(now);
  syncRecordQuestions(now);
  expect(open().length).toBeGreaterThan(2);
  expect(openRaised().some((q) => q.kind === 'timeline')).toBe(true);
  const changes = () => (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  const { syncLinkedin } = await import('./linkedin.ts');
  const { raise } = await import('./raised.ts');
  const timelineNow = openRaised().filter((q) => q.kind === 'timeline').map((q) => ({ key: q.key, text: q.text, choices: q.choices, about: q.about, data: q.data }));
  const { syncSkills } = await import('./skills.ts');
  const skills = () => db.query('SELECT * FROM skills ORDER BY key').all();
  const listed = skills();
  expect(listed.length).toBeGreaterThan(2);
  const before = changes();
  syncRecordQuestions(now + 1);
  syncLinkedin(now + 1);
  raise('timeline', timelineNow, now + 1);
  syncSkills(now + 1);
  syncQuestions(now + 1);
  queue(now + 1);
  expect(changes() - before).toBe(0);
  // What the skills list stores is the same as before.
  expect(skills()).toEqual(listed);
  // A skill gone from every fact is set aside, and one added is listed, as before: only what differs is written.
  db.run("UPDATE facts SET skills = 'Go' WHERE skills LIKE '%TypeScript%'");
  syncSkills(now + 2);
  expect(db.query("SELECT name, facts, in_bank FROM skills WHERE key IN ('typescript', 'go') ORDER BY key").all()).toEqual([{ name: 'Go', facts: 4, in_bank: 1 }, { name: 'TypeScript', facts: 0, in_bank: 0 }]);
});

test('a snoozed record question gives its place on Home to the next, and any open one can be snoozed', async () => {
  const { snooze } = await import('./queue.ts');
  for (let r = 10; r < 20; r++) role({ id: r, company: `Invented Co ${r}`, title: 'Engineer', start: '' });
  syncRecordQuestions(now);
  const home = () => queue(now).items.filter((i) => i.kind === 'record').map((i) => i.key);
  const first = home();
  expect(first.length).toBe(HOME_RECORD);
  expect(snooze(first[0], undefined, now)).toBe('');
  expect(home().length).toBe(HOME_RECORD);
  expect(home()).not.toContain(first[0]);
  // One beyond the first 7 can be snoozed too.
  const later = open().map((q) => q.key).find((k) => !first.includes(k) && !home().includes(k))!;
  expect(snooze(later, undefined, now)).toBe('');
  expect(queue(now).snoozed).toBe(2);
});

test('a job with no story asks for one, and a story told under it settles it; a Day to day fact does not', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2023-01' });
  fact(4, 'Ran the weekly platform review.');
  syncRecordQuestions(now);
  expect(open().map((q) => [q.key, q.text, q.data.route])).toEqual([['record:empty:4', 'Tell a story from Head of Platform at Fernway.', '/record/role/4']]);
  project(4, 'Moved every service to one cloud');
  syncRecordQuestions(now + 1);
  expect(open().map((q) => q.key)).toEqual([expect.stringMatching(/^record:part:\d+:result$/)]);
});

test('a told story’s parts are held back only while it waits to be written or is being written', async () => {
  const { startSitting } = await import('./sittings.ts');
  const p = project(1, 'Rebuilt dispatch');
  startSitting(p, now);
  const asked = (status: string, at: number) => {
    db.query('UPDATE projects SET derive_status = ? WHERE id = ?').run(status, p);
    syncRecordQuestions(at);
    return open().map((q) => q.key);
  };
  expect(asked('queued', now)).toEqual([]);
  expect(asked('running', now + 1)).toEqual([]);
  // Never written (only "I don't know", a sitting left open, or from before deriving), failed, or written: asked.
  for (const [i, status] of ['', 'failed', 'done'].entries()) expect(asked(status, now + 2 + i)).toEqual([`record:part:${p}:result`]);
});

test('an answer about a part that was written since is not lost: it is written over the part, and is the owner’s from then on', () => {
  const p = project(1, 'Rebuilt dispatch');
  syncRecordQuestions(now);
  const key = `record:part:${p}:result`;
  db.query("UPDATE projects SET result = 'Written by deriving.', derived = ? WHERE id = ?").run(JSON.stringify({ result: 'Written by deriving.' }), p);
  expect(answer(key, 0, 'Schedulers stopped using paper.', now + 1, choiceAt(key, 0))).toBe('');
  expect(db.query('SELECT result FROM projects WHERE id = ?').get(p)).toEqual({ result: 'Schedulers stopped using paper.' });
});

test('answer checks: an empty role is not answered here; a month to come, a repository placed since, a role no longer a role', () => {
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '' });
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  syncRecordQuestions(now);
  expect(answer('record:empty:4', 0, '', now, '')).toBe('This question has no answer to give here. It closes once what it asks about is done.');
  expect(raisedByKey('record:empty:4')!.answeredAt).toBe(0);
  // now is in January 2027.
  expect(answer('record:start:4', 0, '2027-06', now, choiceAt('record:start:4', 0))).toBe('That month has not come yet.');
  db.run("UPDATE roles SET standing = 'personal' WHERE id = 5");
  expect(answer('record:place:5', 0, '', now, choiceAt('record:place:5', 0))).toBe('That repository has been placed since. Look at it again.');
  expect(raisedByKey('record:place:5')!.answeredAt).toBe(0);
  db.run("UPDATE roles SET title = '', standing = '' WHERE id = 4");
  expect(answer('record:start:4', 0, '2023-03', now, choiceAt('record:start:4', 0))).toBe('That is no longer one of your roles. Look at it again.');
  expect(raisedByKey('record:start:4')!.answeredAt).toBe(0);
});

test('a repository nobody placed is asked where it belongs before anything about its parts', () => {
  role({ id: 5, company: 'avery/sketchbook', title: '', standing: '' });
  const p = (db.query('INSERT INTO projects (via_role, created_at) VALUES (5, 1) RETURNING id').get() as { id: number }).id;
  expect(recordGaps(gapInput()).map((q) => q.key)).toEqual(['record:place:5']);
  db.run("UPDATE roles SET standing = 'personal' WHERE id = 5");
  expect(recordGaps(gapInput()).map((q) => q.key)).toEqual([`record:part:${p}:result`]);
});

test('a part answered under its name before CARL stays answered: the next part is asked', () => {
  const p = project(1, 'Billing');
  db.query("UPDATE projects SET result = 'One bill.' WHERE id = ?").run(p);
  // "I don't know" given to the action's question when it was keyed "did".
  db.query("INSERT INTO raised_questions (key, kind, text, raised_at, answered_at, answer) VALUES (?, 'record', 'What did you do yourself in “Billing”?', 1, 2, 'I don’t know')").run(`record:part:${p}:did`);
  syncRecordQuestions(now);
  expect(open().filter((q) => q.key.startsWith(`record:part:${p}:`)).map((q) => q.key)).toEqual([`record:part:${p}:context`]);
  db.query("INSERT INTO raised_questions (key, kind, text, raised_at, answered_at, answer) VALUES (?, 'record', 'What was going on before you started “Billing”?', 1, 2, 'I don’t know')").run(`record:part:${p}:situation`);
  syncRecordQuestions(now);
  expect(open().filter((q) => q.key.startsWith(`record:part:${p}:`))).toEqual([]);
});

test('an open question raised before CARL, under the part "did" or "situation", writes its answer to the new column', () => {
  const p = project(1, 'Billing');
  const old = (part: string, text: string) => db.query("INSERT INTO raised_questions (key, kind, text, choices, about, data, raised_at) VALUES (?, 'record', ?, ?, ?, ?, 1)")
    .run(`record:part:${p}:${part}`, text, JSON.stringify(['Write it in one line', 'I don’t know']), `project:${p}`, JSON.stringify({ kind: 'part', subject: p, part, rank: 0, route: '', actions: [{ field: part, input: 'line' }, { field: 'none' }] }));
  old('did', 'What did you do yourself in “Billing”?');
  old('situation', 'What was going on before you started “Billing”?');
  expect(answer(`record:part:${p}:did`, 0, 'I moved the queue.', now, choiceAt(`record:part:${p}:did`, 0))).toBe('');
  expect(answer(`record:part:${p}:situation`, 0, 'Bills went out by hand.', now, choiceAt(`record:part:${p}:situation`, 0))).toBe('');
  expect(db.query('SELECT action, context FROM projects WHERE id = ?').get(p)).toEqual({ action: 'I moved the queue.', context: 'Bills went out by hand.' });
});
