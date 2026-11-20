// `bun test lib`: the Stories screen's data (lib/stories.ts). What it proves: which projects are listed, under which
// job and in what order; the row's quiet line; practices kept, counted and deleted; questions from interviews added,
// given a story, taken off it, marked as needing none; the Home item that each open question raises and when it leaves;
// and what deleting a project or a job does to them. Everything is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, role, seed } from './scratch.ts';
import { allItems } from './queue.ts';
import { addPractice, addQuestion, deletePractice, deleteQuestion, jobQuestions, practiceLine, settleQuestion, storiesList, storyView } from './stories.ts';

// Noon on 19 Nov 2026 in the zone the tests run in, so the day in words is the same in every zone.
const now = new Date(2026, 10, 19, 12).getTime();
let rota = 0, quotes = 0, empty = 0, side = 0, job = 0;
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
const project = (roleId: number, title: string) => (db.query('INSERT INTO projects (role_id, title, created_at) VALUES (?, ?, 1) RETURNING id').get(roleId, title) as { id: number }).id;
const asked = () => allItems(now).filter((i) => i.kind === 'asked');

beforeEach(() => {
  seed();
  db.run('DELETE FROM story_practice');
  db.run('DELETE FROM interview_questions');
  rota = project(1, 'Depot rota console');
  quotes = project(2, 'Quoting rebuild');
  empty = project(1, 'Hiring round');
  db.query("UPDATE projects SET spoken = ? WHERE id = ?").run(words(373), rota);
  db.query("UPDATE projects SET context = 'Quotes took a day.' WHERE id = ?").run(quotes);
  role({ id: 9, company: 'Lantern Notes', title: '', standing: 'personal' });
  side = (db.query("INSERT INTO projects (via_role, created_at, learning) VALUES (9, 1, 'Ship small.') RETURNING id").get() as { id: number }).id;
  job = (db.query("INSERT INTO jobs (url, posting, title, company, status, created_at, outcome) VALUES ('https://jobs.example.com/7', '', 'Platform Lead', 'Nimbus Yard', 'done', 1, 'interviewed') RETURNING id").get() as { id: number }).id;
});

test('the list: every project with a spoken story or a part, under its job newest first, side projects after, each with its time and practice', () => {
  const l = storiesList();
  expect(l.groups.map((g) => [g.name, g.stories.map((s) => [s.title, s.line])])).toEqual([
    ['Director of Engineering at Harborlight Systems', [['Depot rota console', '2 min 40 s · Not practised yet']]],
    ['Senior Engineer at Quillfeather Labs', [['Quoting rebuild', 'No spoken story yet · Not practised yet']]],
    ['Side projects', [['Lantern Notes', 'No spoken story yet · Not practised yet']]],
  ]);
  expect(l.groups[0].stories[0].ref).toBe(`P-${String(rota).padStart(3, '0')}`);
  // The hiring round has nothing to tell yet: it is not listed, and counted.
  expect(l.untold).toBe(1);
  expect(l.choices).toEqual([
    { id: String(rota), label: 'Depot rota console (Director of Engineering at Harborlight Systems)' },
    { id: String(quotes), label: 'Quoting rebuild (Senior Engineer at Quillfeather Labs)' },
    { id: String(side), label: 'Lantern Notes (side project)' }]);
  expect(storyView(empty)).toMatchObject({ title: 'Hiring round', spoken: '', canWrite: false, timeLine: '', over: false });
  expect(storyView(99999)).toBeNull();
});

test('practices: one with today’s date, one timed; the line counts them, the story shows the last timed, and one is deleted', () => {
  expect(practiceLine([])).toBe('Not practised yet');
  expect(addPractice(rota, null, now - 86_400_000)).toBe('');
  expect(practiceLine([{ at: now }])).toBe('Practised once, on 19 Nov 2026');
  expect(addPractice(rota, 185, now)).toBe('');
  expect(addPractice(rota, 2.5, now)).toBe('Send the time it took as a whole number of seconds.');
  expect(addPractice(rota, 0, now)).toBe('Send the time it took as a whole number of seconds.');
  expect(addPractice(99999, null, now)).toBe('That project is no longer in your record.');
  expect(storiesList().groups[0].stories[0].line).toBe('2 min 40 s · Practised 2 times, last on 19 Nov 2026');
  const v = storyView(rota)!;
  expect(v).toMatchObject({ practiceLine: 'Practised 2 times, last on 19 Nov 2026', timeLine: 'About 2 min 40 s when spoken. Last timed at 3 min 05 s.', over: false });
  expect(v.practices.map((p) => [p.on, p.timed])).toEqual([['19 Nov 2026', '3 min 05 s'], ['18 Nov 2026', '']]);
  expect(deletePractice(Number(v.practices[0].id))).toBe(true);
  expect(deletePractice(Number(v.practices[0].id))).toBe(false);
  expect(storyView(rota)).toMatchObject({ practiceLine: 'Practised once, on 18 Nov 2026', timeLine: 'About 2 min 40 s when spoken.' });
});

test('a timed practice over two hours is kept with no time', () => {
  expect(addPractice(rota, 7201, now)).toBe('');
  expect(storyView(rota)!.practices.map((p) => p.timed)).toEqual(['']);
});

test('a spoken text with no word shows no time', () => {
  db.query("UPDATE projects SET spoken = '— …' WHERE id = ?").run(rota);
  expect(storyView(rota)).toMatchObject({ timeLine: '', over: false });
  expect(storiesList().groups[0].stories[0].line).toBe('No spoken story yet · Not practised yet');
});

test('a question is linked only to a told story, by a number; an exact repeat is refused; a job with no name says so on Home', () => {
  const a = addQuestion('Why this team?', job, now);
  if (!a.ok) throw new Error('not added');
  expect(addQuestion('  why THIS   team? ', job, now)).toEqual({ ok: false, error: 'That question is in this job’s list already.', status: 409 });
  expect(addQuestion('Why this team?', null, now).ok).toBe(true);
  expect(addQuestion('why this team?', '', now)).toEqual({ ok: false, error: 'That question is in your list already.', status: 409 });
  expect(settleQuestion(a.id, { project: true })).toBe('Say which story answers it, by its number.');
  expect(settleQuestion(a.id, { project: '1e0' })).toBe('Say which story answers it, by its number.');
  expect(settleQuestion(a.id, { project: String(empty) })).toBe('That piece of work has nothing told yet. Tell it first, then choose it.');
  expect(settleQuestion(a.id, { project: rota })).toBe('');
  // Its story emptied later: it stays linked, by the project's title.
  db.query("UPDATE projects SET spoken = '' WHERE id = ?").run(rota);
  expect(storiesList().questions.find((q) => q.id === String(a.id))).toMatchObject({ projectId: String(rota), story: 'Depot rota console' });
  db.query("UPDATE jobs SET title = '', company = '' WHERE id = ?").run(job);
  settleQuestion(a.id, { project: null });
  expect(asked().find((i) => i.key === `asked:${a.id}`)?.from).toBe('From an interview at a job with no title yet');
});

test('a story over 3 min 30 s says so in its line', () => {
  db.query("UPDATE projects SET spoken = ? WHERE id = ?").run(words(583), rota);
  expect(storyView(rota)).toMatchObject({ timeLine: 'About 4 min 10 s when spoken. Aim for 3 min 30 s or less.', over: true });
});

test('questions: added at a job or at none, given a story, taken off it, marked as needing none; Home has one item for each open one', () => {
  expect(addQuestion('  ', job, now)).toEqual({ ok: false, error: 'Write the question you were asked.', status: 400 });
  expect(addQuestion('x'.repeat(501), job, now)).toMatchObject({ ok: false, status: 400 });
  expect(addQuestion('Why us?', 99999, now)).toEqual({ ok: false, error: 'That job is no longer in your tracker.', status: 404 });
  const a = addQuestion('Tell me about a time you changed a plan.', job, now);
  const b = addQuestion('What would you do in your first month?', '', now + 1);
  if (!a.ok || !b.ok) throw new Error('not added');
  expect(storiesList().questions.map((q) => [q.text, q.job, q.added, q.story, q.noStory])).toEqual([
    ['What would you do in your first month?', '', '19 Nov 2026', '', false],
    ['Tell me about a time you changed a plan.', 'Platform Lead at Nimbus Yard', '19 Nov 2026', '', false]]);
  expect(asked().map((i) => [i.key, i.text, i.from, i.route])).toEqual([
    [`asked:${b.id}`, 'You were asked “What would you do in your first month?” and no story answers it yet.', 'From your interviews', `/record/stories#question-${b.id}`],
    [`asked:${a.id}`, 'You were asked “Tell me about a time you changed a plan.” and no story answers it yet.', 'From your interview for Platform Lead at Nimbus Yard', `/record/stories#question-${a.id}`]]);
  // A story chosen: it leaves Home, and the story lists it.
  expect(settleQuestion(a.id, { project: String(rota) })).toBe('');
  expect(asked().map((i) => i.key)).toEqual([`asked:${b.id}`]);
  expect(storyView(rota)!.questions).toEqual([{ id: String(a.id), text: 'Tell me about a time you changed a plan.', job: 'Platform Lead at Nimbus Yard' }]);
  expect(jobQuestions(job).questions.map((q) => [q.text, q.story])).toEqual([['Tell me about a time you changed a plan.', 'Depot rota console']]);
  // Taken off it: back on Home.
  expect(settleQuestion(a.id, { project: '' })).toBe('');
  expect(asked().length).toBe(2);
  // No story needed: it leaves Home and says so; a story chosen later takes that back.
  expect(settleQuestion(b.id, { noStory: true })).toBe('');
  expect(asked().map((i) => i.key)).toEqual([`asked:${a.id}`]);
  expect(storiesList().questions[0]).toMatchObject({ noStory: true, story: '' });
  expect(settleQuestion(b.id, { project: String(quotes) })).toBe('');
  expect(storiesList().questions[0]).toMatchObject({ noStory: false, story: 'Quoting rebuild' });
  expect(settleQuestion(b.id, { project: '99999' })).toBe('That project is no longer in your record.');
  expect(settleQuestion(b.id, {})).toBe('Say which story answers it, or that none is needed.');
  expect(settleQuestion(99999, { noStory: true })).toBe('That question is no longer in your list.');
  expect(deleteQuestion(a.id)).toBe(true);
  expect(asked()).toEqual([]);
});

test('deleting a project takes its practices and clears the link on its questions; deleting a job keeps its questions and clears their job', () => {
  addPractice(rota, 120, now);
  const a = addQuestion('Tell me about a system you built.', job, now);
  if (!a.ok) throw new Error('not added');
  settleQuestion(a.id, { project: String(rota) });
  db.query('DELETE FROM projects WHERE id = ?').run(rota);
  expect(db.query('SELECT count(*) AS n FROM story_practice').get()).toEqual({ n: 0 });
  expect(db.query('SELECT project_id, job_id FROM interview_questions').get()).toEqual({ project_id: null, job_id: job });
  expect(asked().length).toBe(1);
  db.query('DELETE FROM jobs WHERE id = ?').run(job);
  expect(db.query('SELECT text, project_id, job_id FROM interview_questions').get()).toEqual({ text: 'Tell me about a system you built.', project_id: null, job_id: null });
  expect(asked()[0].from).toBe('From your interviews');
});
