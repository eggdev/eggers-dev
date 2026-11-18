// `bun test lib`: the Skills screen's list (lib/skillsview.ts). The whole list in its groups, each skill with how many
// facts name it and in how many roles; skills new since the last review first; a mark set from the list goes through
// the Home question's own answer when one is open, so Home and the list agree; a tap that changes nothing writes nothing.
// On a scratch database with an invented person. No model is asked.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { markFromList, skillsView } from './skillsview.ts';
import { markSkills, syncSkills } from './skills.ts';
import { answer, choiceAt, openRaised, raisedByKey } from './raised.ts';
import { bankSignature } from './db.ts';

const NOW = Date.UTC(2026, 2, 3, 12);
beforeEach(() => { seed(); syncSkills(NOW); });
const changes = () => (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
const skill = (name: string) => skillsView().groups.flatMap((g) => g.skills).find((s) => s.name === name);

test('the list in its groups, each with its facts and roles; before a review there is no group of new skills', () => {
  const v = skillsView();
  expect([v.reviewed, v.reviewedOn, v.newCount]).toEqual([false, '', 0]);
  expect(v.groups.map((g) => g.id)).toEqual(['tool', 'language', 'other']);
  expect(v.groups.map((g) => g.title)).toEqual(['Tools', 'Languages', 'Not a tool, language or platform: never on a resume']);
  // Go is named by a fact of Harborlight and one of Quillfeather: 2 facts in 2 roles.
  expect(skill('Go')).toMatchObject({ key: 'go', kind: 'language', mark: '', facts: 2, roles: 2, isNew: false });
  expect(skill('Go')!.factList.map((f) => f.text)).toEqual(['Cut the nightly billing run.', 'Rebuilt the quoting API.']);
  expect(skill('Go')!.factList[0].ref).toMatch(/^F-\d{4}$/);
  expect(skill('PostgreSQL')).toMatchObject({ facts: 2, roles: 1 });
});

test('after a review, skills the record gains are new and come first; a skill no fact names any more is not listed', () => {
  expect(markSkills([{ name: 'Go', mark: 'confident' }], true, NOW).refused).toBeUndefined();
  fact(1, 'Moved the queue.', '', 'Redis');
  syncSkills(NOW + 1);
  const v = skillsView();
  expect([v.reviewed, v.reviewedOn, v.newCount]).toEqual([true, '3 Mar 2026', 1]);
  expect(v.groups[0]).toMatchObject({ id: 'new', title: 'New since your last review' });
  expect(v.groups[0].skills.map((s) => [s.name, s.isNew, s.question])).toEqual([['Redis', true, true]]);
  // A new skill is under its head only, not twice.
  expect(v.groups.flatMap((g) => g.skills).filter((s) => s.name === 'Redis').length).toBe(1);
  db.run("UPDATE facts SET skills = '' WHERE text = 'Moved the queue.'");
  syncSkills(NOW + 2);
  expect(skill('Redis')).toBeUndefined();
});

test('a mark from the list answers the open Home question, so Home and the list agree; the same mark again writes nothing', () => {
  expect(markSkills([{ name: 'Go', mark: 'confident' }], true, NOW).refused).toBeUndefined();
  fact(1, 'Moved the queue.', '', 'Redis');
  syncSkills(NOW + 1);
  expect(openRaised().map((q) => q.key)).toEqual(['skill:redis']);
  expect(markFromList([{ name: 'Redis', mark: 'confident' }], false, NOW + 2)).toMatchObject({ marked: 1 });
  expect(raisedByKey('skill:redis')).toMatchObject({ answer: 'Yes, I am confident in it' });
  expect(openRaised()).toEqual([]);
  expect(skill('Redis')).toMatchObject({ mark: 'confident', question: false });
  // A tap on the mark it already has changes nothing and writes nothing; neither does a skill's mark move the signature.
  const before = changes(), sig = bankSignature();
  expect(markFromList([{ name: 'Redis', mark: 'confident' }], false, NOW + 3)).toMatchObject({ marked: 0 });
  expect(changes() - before).toBe(0);
  expect(markFromList([{ name: 'Go', mark: 'not-confident' }, { name: 'TypeScript', mark: 'confident' }], false, NOW + 4).marked).toBe(2);
  expect(bankSignature()).toBe(sig);
});

test('an answer on Home shows on the list', () => {
  expect(markSkills([{ name: 'Go', mark: 'confident' }], true, NOW).refused).toBeUndefined();
  fact(1, 'Moved the queue.', '', 'Redis');
  syncSkills(NOW + 1);
  expect(answer('skill:redis', 1, '', NOW + 2, choiceAt('skill:redis', 1))).toBe('');
  expect(skill('Redis')).toMatchObject({ mark: 'not-confident', question: false });
});

test('a review is refused in words while no tool, language or platform is marked confident, and saves nothing', () => {
  expect(markFromList([], true, NOW)).toMatchObject({ marked: 0, refused: 'Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.' });
  expect(skillsView().reviewed).toBe(false);
  expect(markFromList([{ name: 'Go', mark: 'confident' }], false, NOW)).toMatchObject({ marked: 1 });
  expect(markFromList([], true, NOW + 5)).toMatchObject({ marked: 0 });
  expect(skillsView()).toMatchObject({ reviewed: true, reviewedOn: '3 Mar 2026', newCount: 0 });
});

// ---------- Review of the Skills screen ----------
const markOf = (key: string) => (db.query('SELECT mark FROM skills WHERE key = ?').get(key) as { mark: string }).mark;

test('an empty mark changes nothing: "Not marked" is said on purpose, with its word', () => {
  expect(markFromList([{ name: 'Go', mark: 'confident' }], false, NOW)).toMatchObject({ marked: 1 });
  expect(markFromList([{ name: 'Go', mark: '' }], true, NOW + 1)).toMatchObject({ marked: 0 });
  expect(markOf('go')).toBe('confident');
  expect(markFromList([{ name: 'TypeScript', mark: 'confident' }, { name: 'Go', mark: 'unmarked' }], false, NOW + 2)).toMatchObject({ marked: 2 });
  expect(markOf('go')).toBe('');
});

test('a mark refused by the review rule saves nothing, not even the Home answer before it', () => {
  expect(markFromList([{ name: 'Go', mark: 'confident' }], true, NOW).refused).toBeUndefined();
  // The only confident skill leaves the record; a new skill is asked about on Home.
  db.run("UPDATE facts SET skills = replace(replace(skills, 'Go, ', ''), ', Go', '')");
  fact(1, 'Moved the queue.', '', 'Redis');
  syncSkills(NOW + 1);
  expect(openRaised().map((q) => q.key)).toEqual(['skill:redis']);
  const r = markFromList([{ name: 'Redis', mark: 'not-confident' }], false, NOW + 2);
  expect(r.refused).toBe('Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.');
  expect(markOf('redis')).toBe('');
  expect(openRaised().map((q) => q.key)).toEqual(['skill:redis']);
});

test('a mark whose Home question was answered a moment before is still applied; a changed question is refused in words', () => {
  expect(markFromList([{ name: 'Go', mark: 'confident' }], true, NOW).refused).toBeUndefined();
  fact(1, 'Moved the queue.', '', 'Redis');
  syncSkills(NOW + 1);
  // The list was read while the question was open; Home answered it first.
  expect(answer('skill:redis', 0, '', NOW + 2, choiceAt('skill:redis', 0))).toBe('');
  expect(markFromList([{ name: 'Redis', mark: 'not-confident' }], false, NOW + 3)).toMatchObject({ marked: 1 });
  expect(markOf('redis')).toBe('not-confident');
  // A question whose words changed is not answered by the place of a choice.
  fact(1, 'Ran the invented broker.', '', 'Zephyrmq');
  syncSkills(NOW + 4);
  db.run(`UPDATE raised_questions SET choices = '["Something else","No, leave it off my resumes"]' WHERE key = 'skill:zephyrmq'`);
  expect(markFromList([{ name: 'Zephyrmq', mark: 'confident' }], false, NOW + 5)).toEqual({ marked: 0, changed: 0, refused: 'The question about Zephyrmq on Home changed. Look at it again.' });
  expect(markOf('zephyrmq')).toBe('');
});

test('a change of kind alone counts as a change; entries that are not marks are skipped', () => {
  expect(markFromList([{ name: 'Kafka', kind: 'other' }], false, NOW)).toMatchObject({ marked: 0, changed: 1 });
  expect(markFromList([{ name: 'Kafka', kind: 'other' }], false, NOW + 1)).toMatchObject({ marked: 0, changed: 0 });
  expect(markFromList([null, 7, 'Go', { name: 'Go', mark: 'confident' }] as never, false, NOW + 2)).toMatchObject({ marked: 1, changed: 1 });
});
