// `bun test lib`: the skills list of rule 7, on a scratch database with an invented person (lib/scratch.ts).
// What may be on a resume before and after the person's first review, the cap, the order, and that a phrase
// from the posting can never be added.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, reset } from './scratch.ts';
import { openRaised } from './raised.ts';
import { allSkills, capFor, kindOf, markSkills, NONE_CONFIDENT, resumeSkills, reviewed, skillProblems, syncSkills, withSkills } from './skills.ts';

beforeEach(() => {
  reset();
  fact(1, 'Built the console.', '', 'TypeScript, PostgreSQL, code review');
  fact(1, 'Cut the billing run.', '', 'Go, PostgreSQL, AWS');
  fact(2, 'Rebuilt the API.', '', 'Go, Kafka, mentoring, typescript');
  syncSkills(1000);
});
const POSTING = 'We need Kafka and Go. Cross-team collaboration, enterprise reliability and AWS are a plus. Kafka at scale.';

test('the list is filled from the bank, with a kind for each skill', () => {
  expect(allSkills().map((s) => [s.name, s.kind, s.mark, s.facts])).toEqual([['Go', 'language', '', 2], ['PostgreSQL', 'tool', '', 2], ['TypeScript', 'language', '', 2], ['AWS', 'platform', '', 1], ['code review', 'other', '', 1], ['Kafka', 'tool', '', 1], ['mentoring', 'other', '', 1]]);
  expect(['Rust', 'Cloudflare Workers', 'Next.js', 'stakeholder management', 'CI/CD', 'data pipelines', 'cross-team'].map(kindOf)).toEqual(['language', 'platform', 'tool', 'other', 'other', 'other', 'other']);
});

test('the list follows the bank: a new skill is added and a skill no fact names is set aside with its mark', () => {
  markSkills([{ name: 'Kafka', mark: 'confident' }], false, 1500);
  db.run("UPDATE facts SET skills = 'Go, Rust' WHERE text = 'Rebuilt the API.'");
  syncSkills(2000);
  expect(allSkills().map((s) => s.name)).toEqual(['Go', 'PostgreSQL', 'AWS', 'code review', 'Rust', 'TypeScript']);
  db.run("UPDATE facts SET skills = 'Go, Kafka' WHERE text = 'Rebuilt the API.'");
  syncSkills(3000);
  expect(allSkills().find((s) => s.name === 'Kafka')!.mark).toBe('confident');
});

test('before the first review: tools, languages and platforms not yet marked may appear, the posting\'s first', () => {
  expect(reviewed()).toBe(false);
  // Kafka is named twice, Go once and first, AWS once and later; the rest follow by how many facts show them.
  expect(resumeSkills(POSTING, 2)).toEqual(['Kafka', 'Go', 'AWS', 'PostgreSQL', 'TypeScript']);
  markSkills([{ name: 'Kafka', mark: 'not-confident' }], false, 1500);
  expect(resumeSkills(POSTING, 2)).toEqual(['Go', 'AWS', 'PostgreSQL', 'TypeScript']);
  expect(skillProblems(['Go', 'Kafka'], 2)).toMatchObject({ unconfirmed: true, notAllowed: ['Kafka'] });
});

test('after the first review only skills marked confident appear, and a later skill raises a question', () => {
  markSkills([{ name: 'Go', mark: 'confident' }, { name: 'kafka', mark: 'confident' }, { name: 'AWS', mark: 'not-confident' }], true, 2000);
  expect(reviewed()).toBe(true);
  expect(resumeSkills(POSTING, 2)).toEqual(['Kafka', 'Go']);
  expect(skillProblems(['Go', 'PostgreSQL'], 2)).toMatchObject({ unconfirmed: false, notAllowed: ['PostgreSQL'] });
  // Skills that were there at the review and left unmarked raise nothing.
  syncSkills(2500);
  expect(openRaised()).toEqual([]);
  fact(1, 'Moved the queue.', '', 'Redis, pair programming');
  syncSkills(3000);
  const asked = openRaised();
  expect(asked.map((q) => [q.key, q.kind, q.choices.length])).toEqual([['skill:redis', 'skill', 2]]);
  expect(resumeSkills(POSTING, 2)).not.toContain('Redis');
});

test('a phrase from the posting is never added, and the person can correct a kind', () => {
  const got = resumeSkills(POSTING, 2);
  for (const phrase of ['cross-team', 'collaboration', 'enterprise', 'reliability']) expect(got.join(' ').toLowerCase()).not.toContain(phrase);
  markSkills([{ name: 'code review', kind: 'tool' }], false, 1500);
  expect(resumeSkills(POSTING, 2)).toContain('code review');
});

test('the cap is 25 on two pages and 14 on one', () => {
  fact(1, 'Used many tools.', '', Array.from({ length: 40 }, (_, i) => `Tool${i}`).join(', '));
  syncSkills(1500);
  expect([capFor(2), capFor(1)]).toEqual([25, 14]);
  expect(resumeSkills(POSTING, 2).length).toBe(25);
  expect(resumeSkills(POSTING, 1).length).toBe(14);
  expect(resumeSkills(POSTING, 2).slice(0, 3)).toEqual(['Kafka', 'Go', 'AWS']);
  expect(skillProblems(Array.from({ length: 30 }, (_, i) => `Tool${i}`), 2)).toMatchObject({ over: 5, cap: 25 });
});

test('the Skills section of a written resume is written from the list', () => {
  const resume = '# Avery Lindqvist\n\n## Experience\n### Engineer, Harborlight Systems\n- Built it.\n\n## Skills\n\nTypeScript, cross-team collaboration, enterprise reliability, Go\n\n## Education\n\nBSc';
  const got = withSkills(resume, POSTING, 2);
  // The writer's own choice (TypeScript) comes before a skill it did not choose (PostgreSQL), after the posting's.
  expect(got).toContain('## Skills\n\nKafka, Go, AWS, TypeScript, PostgreSQL\n\n## Education');
  expect(got).not.toContain('cross-team');
  expect(withSkills(got, POSTING, 2)).toBe(got);
  expect(withSkills('# Avery Lindqvist\n\n## Experience\n- x\n\n## Education\n\nBSc', POSTING, 2)).toContain('## Skills\n\nKafka, Go, AWS, PostgreSQL, TypeScript\n\n## Education');
});

test('real tools written in lower case are tools, and so is a product name that holds a practice word', () => {
  for (const name of ['git', 'npm', 'bun', 'nginx', 'jq', 'curl', 'vim', 'make', 'webpack', 'vite', 'jest', 'pytest', 'terraform', 'ansible', 'docker', 'redis', 'postgres', 'sqlite', 'grpc',
    'React Testing Library', 'AWS Systems Manager', 'Spring Security', 'Azure DevOps', 'Docker', 'GitHub Actions']) expect([name, kindOf(name)]).toEqual([name, 'tool']);
  expect(['kubernetes', 'Kubernetes', 'graphql', 'GraphQL'].map(kindOf)).toEqual(['platform', 'platform', 'language', 'language']);
  // A practice or a soft skill is still neither, however it is capitalised.
  for (const name of ['Leadership', 'Team Management', 'Machine Learning', 'Public Speaking', 'code review', 'Agile', 'unit testing', 'event sourcing', 'Project Management', 'CI/CD']) expect([name, kindOf(name)]).toEqual([name, 'other']);
});

test('marking a few skills is not a review, and a review needs one skill the person is confident in', () => {
  // A partial save: one mark, and the list is still not reviewed, so skills not yet marked still appear.
  expect(markSkills([{ name: 'Kafka', mark: 'not-confident' }], false, 1500)).toMatchObject({ marked: 1 });
  expect(reviewed()).toBe(false);
  expect(resumeSkills(POSTING, 2)).toEqual(['Go', 'AWS', 'PostgreSQL', 'TypeScript']);
  // A review with no confident tool, language or platform is refused, and nothing in the request is saved.
  expect(markSkills([{ name: 'Go', mark: 'not-confident' }, { name: 'code review', mark: 'confident' }], true, 1600)).toMatchObject({ marked: 0, refused: NONE_CONFIDENT });
  expect(NONE_CONFIDENT).toBe('Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.');
  expect(reviewed()).toBe(false);
  expect(allSkills().find((s) => s.name === 'Go')!.mark).toBe('');
  expect(markSkills([{ name: 'Go', mark: 'confident' }], true, 1700)).toMatchObject({ marked: 1 });
  expect(reviewed()).toBe(true);
  // After the review, a change that would leave nothing to show is refused too: the Skills section is never emptied.
  expect(markSkills([{ name: 'Go', mark: 'not-confident' }], false, 1800)).toMatchObject({ marked: 0, refused: NONE_CONFIDENT });
  expect(resumeSkills(POSTING, 2)).toEqual(['Go']);
  expect(withSkills('# Avery Lindqvist\n\n## Skills\n\nKafka, Go\n', POSTING, 2)).toContain('## Skills\n\nGo');
});
