// `bun test lib`: Home's list (lib/queue.ts) on a scratch database (lib/scratch.ts), with the invented person.
// Its order, what a timeline question blocks, and a snooze that hides an item and lets it return.
import { beforeEach, expect, test } from 'bun:test';
import { db, role, seed } from './scratch.ts';
import { syncQuestions } from './checks.ts';
import { answer, choiceAt } from './raised.ts';
import { queue, QUIET_DAYS, snooze, SNOOZE_MS } from './queue.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17, 12);

// A resume that shows the given employers, as the writer prints them.
const resume = (...companies: string[]) => `# Avery Lindqvist
Duluth, MN · avery@lindqvist.example

## Summary
Engineer who builds logistics software.

## Experience
${companies.map((c, i) => `### Engineer, ${c}\nJan 20${10 + i} – Dec 20${11 + i}\n- Built a thing at ${c}.`).join('\n\n')}
`;
const job = (title: string, company: string, text: string, outcome = '', appliedAt = 0): number =>
  (db.query('INSERT INTO jobs (title, company, status, resume, outcome, applied_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id').get(title, company, 'done', text, outcome, appliedAt, NOW - 30 * DAY) as { id: number }).id;

beforeEach(() => {
  seed();
  // A second job that also says Present: the timeline raises a question about the two.
  role({ id: 4, company: 'Northwind Cartage', title: 'Advisor', start: '2023-01' });
  db.run("UPDATE profile SET gaps = 'What did the dispatch console replace?' WHERE id = 1");
});

test('raised questions come first, then questions open in Talk, then applications gone quiet', () => {
  job('Staff Engineer', 'Globex', '', 'applied', NOW - 20 * DAY);
  const initech = job('Platform Lead', 'Initech', '', 'applied', NOW - 30 * DAY);
  job('Engineer', 'Hooli', '', 'applied', NOW - 3 * DAY);
  syncQuestions(NOW);
  const q = queue(NOW);
  expect(q.items.map((i) => i.kind)).toEqual(['timeline', 'talk', 'quiet', 'quiet']);
  const [first, talk, older, newer] = q.items;
  expect(first.key).toBe('two-current:1:4');
  expect(first.choices.length).toBe(3);
  expect(first.inputs).toEqual(['month', 'month', 'line']);
  expect(first.route).toBe('');
  expect(talk).toMatchObject({ text: 'What did the dispatch console replace?', from: 'From your profile', route: '/talk/questions', choices: [] });
  // The oldest application first; the one sent 3 days ago has not gone quiet.
  expect(older).toMatchObject({ key: `quiet:${initech}`, text: 'Platform Lead at Initech: no reply in 30 days.', route: `/job/${initech}` });
  expect(newer.text).toBe('Staff Engineer at Globex: no reply in 20 days.');
  expect(q.snoozed).toBe(0);
  // A key does not change while the item is open.
  expect(queue(NOW + 1000).items.map((i) => i.key)).toEqual(q.items.map((i) => i.key));
});

test('an application goes quiet on the fourteenth day with no reply, and leaves once it has an answer', () => {
  const id = job('Staff Engineer', 'Globex', '', 'applied', NOW - QUIET_DAYS * DAY + 1);
  expect(queue(NOW).items.filter((i) => i.kind === 'quiet')).toEqual([]);
  expect(queue(NOW + 1).items.filter((i) => i.kind === 'quiet').map((i) => i.key)).toEqual([`quiet:${id}`]);
  db.query("UPDATE jobs SET outcome = 'interviewed' WHERE id = ?").run(id);
  expect(queue(NOW + 1).items.filter((i) => i.kind === 'quiet')).toEqual([]);
});

test('a timeline question says how many unsent resumes show one of its roles', () => {
  syncQuestions(NOW);
  expect(queue(NOW).items[0].blocks).toBe('');
  job('A', 'Globex', resume('Harborlight Systems', 'Quillfeather Labs'));
  expect(queue(NOW).items[0].blocks).toBe('Blocks 1 resume');
  job('B', 'Initech', resume('Northwind Cartage'));
  // A resume that shows neither role, and one already sent, are not held up.
  job('C', 'Hooli', resume('Quillfeather Labs'));
  job('D', 'Umbrella', resume('Harborlight Systems'), 'applied', NOW - DAY);
  expect(queue(NOW).items[0].blocks).toBe('Blocks 2 resumes');
  // Answered, the question leaves the list.
  expect(answer('two-current:1:4', 2, 'The advisory work is two hours a month.', NOW, choiceAt('two-current:1:4', 2))).toBe('');
  syncQuestions(NOW);
  expect(queue(NOW).items.map((i) => i.kind)).toEqual(['talk']);
});

test('a snoozed item is hidden and counted until its time passes, then it returns', () => {
  syncQuestions(NOW);
  const talk = queue(NOW).items.find((i) => i.kind === 'talk')!;
  expect(snooze(talk.key, undefined, NOW)).toBe('');
  expect(queue(NOW).items.map((i) => i.kind)).toEqual(['timeline']);
  expect(queue(NOW).snoozed).toBe(1);
  expect(queue(NOW + SNOOZE_MS - 1).snoozed).toBe(1);
  expect(queue(NOW + SNOOZE_MS).items.map((i) => i.key)).toEqual(['two-current:1:4', talk.key]);
  expect(queue(NOW + SNOOZE_MS).snoozed).toBe(0);
  // A time of the person's choosing; snoozing again moves it.
  expect(snooze('two-current:1:4', NOW + 2 * DAY, NOW)).toBe('');
  expect(snooze('two-current:1:4', NOW + 3 * DAY, NOW)).toBe('');
  expect(queue(NOW + 2 * DAY).snoozed).toBe(1);
  expect(queue(NOW + 3 * DAY).snoozed).toBe(0);
});

test('a snooze is refused for an item that is gone and for a time that is not later', () => {
  syncQuestions(NOW);
  expect(snooze('talk:000000000000', undefined, NOW)).toBe('That item no longer needs you.');
  expect(snooze('two-current:1:4', NOW, NOW)).toBe('Choose a time later than now.');
  expect(snooze('two-current:1:4', NOW + 400 * DAY, NOW)).toBe('Choose a time within a year.');
  expect(queue(NOW).snoozed).toBe(0);
});

test('a snoozed item that stops needing the person is no longer counted', () => {
  syncQuestions(NOW);
  expect(snooze('two-current:1:4', undefined, NOW)).toBe('');
  // The person ends one of the jobs elsewhere: the question is no longer live, so nothing is snoozed.
  db.run("UPDATE roles SET end = '2024-01' WHERE id = 4");
  syncQuestions(NOW);
  expect(queue(NOW).snoozed).toBe(0);
});
