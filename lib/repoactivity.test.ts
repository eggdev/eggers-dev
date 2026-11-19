// `bun test lib`: what was read from a repository about the owner's own commits (lib/repoactivity.ts). The authors,
// emails and repositories are invented. The git test makes its repository in a temporary folder and removes it.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, reset, role } from './scratch.ts';
import { ACTIVE_MONTHS, isActive, monthsBefore, readCommits, readRepo, recordRepo, repo, repoActivity, summarize } from './repoactivity.ts';

// The owner's two invented identities, and a colleague's.
const OWNER = ['avery@lindqvist.example', 'Avery.L@Harborlight.example'];
const COLLEAGUE = 'rowan@quillfeather.example';

beforeEach(() => {
  reset();
  db.run('DELETE FROM repo_activity');
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
});

test('the commit summary counts only the owner\'s identities, in any case, and orders dates as instants', () => {
  const s = summarize([
    { email: 'avery@lindqvist.example', date: '2024-03-10T09:00:00+00:00' },
    { email: COLLEAGUE, date: '2020-01-01T00:00:00+00:00' },
    { email: 'AVERY.L@harborlight.example', date: '2025-06-01T23:30:00-05:00' },
    // Earlier as an instant than the one above, though its date reads later.
    { email: ' avery@lindqvist.example ', date: '2025-06-02T01:00:00+09:00' },
    { email: COLLEAGUE, date: '2026-11-01T00:00:00+00:00' },
    // A date that cannot be read: still the owner's commit, never a first or last.
    { email: 'avery@lindqvist.example', date: 'not a date' },
  ], OWNER);
  expect(s).toEqual({ first: '2024-03-10T09:00:00+00:00', last: '2025-06-01T23:30:00-05:00', commits: 4 });
  expect(summarize([{ email: COLLEAGUE, date: '2026-01-01T00:00:00Z' }], OWNER)).toEqual({ first: '', last: '', commits: 0 });
  expect(summarize([{ email: '', date: '2026-01-01T00:00:00Z' }], ['', ' '])).toEqual({ first: '', last: '', commits: 0 });
});

test('active is a last commit within the window of calendar months, the boundary included', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  expect(ACTIVE_MONTHS).toBe(6);
  expect(new Date(monthsBefore(now, 6)).toISOString()).toBe('2026-05-18T12:00:00.000Z');
  expect(isActive('2026-05-18T12:00:00Z', now)).toBe(true);
  expect(isActive('2026-05-18T11:59:59.999Z', now)).toBe(false);
  expect(isActive('2026-05-19T12:00:00Z', now)).toBe(true);
  expect(isActive('2026-05-17T12:00:00Z', now)).toBe(false);
  // The same instant in another zone.
  expect(isActive('2026-05-18T07:00:00-05:00', now)).toBe(true);
  // The window is a parameter.
  expect(isActive('2026-05-17T12:00:00Z', now, 7)).toBe(true);
  expect(isActive('', now)).toBe(false);
  // A day the earlier month lacks is its last day.
  expect(new Date(monthsBefore(Date.parse('2026-08-31T08:00:00Z'), 6)).toISOString()).toBe('2026-02-28T08:00:00.000Z');
  expect(new Date(monthsBefore(Date.parse('2026-01-15T00:00:00Z'), 13)).toISOString()).toBe('2024-12-15T00:00:00.000Z');
});

// ---------- Reading a repository with git ----------

const scratch = mkdtempSync(join(tmpdir(), 'egg-repo-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// git with nothing from this machine's own settings, and an invented author and date for each commit.
function git(dir: string, args: string[], who = { name: 'Avery Lindqvist', email: 'avery@lindqvist.example' }, date = '2025-01-01T10:00:00+00:00') {
  const p = Bun.spawnSync(['git', '-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { stdout: 'pipe', stderr: 'pipe', env: {
    PATH: process.env.PATH ?? '', HOME: scratch, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: date } });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
}
function commit(dir: string, file: string, who: { name: string; email: string }, date: string) {
  writeFileSync(join(dir, file), `${file} ${date}\n`);
  git(dir, ['add', file], who, date);
  git(dir, ['commit', '-q', '--no-verify', '-m', `Add ${file}`], who, date);
}

test('the git reader reads every branch of a temporary repository, without merges', () => {
  const dir = join(scratch, 'tide-tables');
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  const avery = { name: 'Avery Lindqvist', email: 'avery@lindqvist.example' }, work = { name: 'Avery Lindqvist', email: 'avery.l@harborlight.example' }, rowan = { name: 'Rowan Pike', email: COLLEAGUE };
  commit(dir, 'a.txt', avery, '2024-02-01T10:00:00+00:00');
  commit(dir, 'b.txt', rowan, '2024-03-01T10:00:00+00:00');
  git(dir, ['checkout', '-q', '-b', 'side']);
  commit(dir, 'c.txt', work, '2025-04-01T10:00:00+02:00');
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'd.txt', rowan, '2025-05-01T10:00:00+00:00');
  git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'side'], avery, '2025-06-01T10:00:00+00:00');
  // A branch never merged is read too.
  git(dir, ['checkout', '-q', '-b', 'spike', 'side']);
  commit(dir, 'e.txt', avery, '2025-07-01T10:00:00+00:00');
  // A stash is unfinished work: its commits are not read, though they are the owner's and the newest.
  writeFileSync(join(dir, 'e.txt'), 'half done\n');
  git(dir, ['stash', '-q'], avery, '2025-08-01T10:00:00+00:00');

  const r = readCommits(dir);
  if (!r.ok) throw new Error(r.error);
  expect(r.commits.map((c) => `${c.email} ${c.date}`).sort()).toEqual([
    'avery.l@harborlight.example 2025-04-01T10:00:00+02:00',
    'avery@lindqvist.example 2024-02-01T10:00:00Z',
    'avery@lindqvist.example 2025-07-01T10:00:00Z',
    'rowan@quillfeather.example 2024-03-01T10:00:00Z',
    'rowan@quillfeather.example 2025-05-01T10:00:00Z',
  ]);
  expect(summarize(r.commits, OWNER)).toEqual({ first: '2024-02-01T10:00:00Z', last: '2025-07-01T10:00:00Z', commits: 3 });

  // Git settings in the caller's environment do not reach the reader: each of these alone would make git fail.
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { GIT_OBJECT_DIRECTORY: join(scratch, 'nowhere'), GIT_COMMON_DIR: join(scratch, 'nowhere'), GIT_DIR: join(scratch, 'nowhere'), GIT_INDEX_FILE: join(scratch, 'nowhere') });
    const again = readCommits(dir);
    expect(again.ok && again.commits.length).toBe(5);
  } finally {
    for (const k of ['GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }

  // Read and stored in one step, tied to a role.
  expect(readRepo(dir, OWNER, { roleId: 1 }, Date.parse('2025-09-01T00:00:00Z'))).toBe('');
  expect(repo(dir, Date.parse('2025-09-01T00:00:00Z'))).toEqual({ key: dir, roleId: 1, projectId: null, first: '2024-02-01T10:00:00Z', last: '2025-07-01T10:00:00Z', commits: 3, readAt: Date.parse('2025-09-01T00:00:00Z'), active: true });
  expect(repo(dir, Date.parse('2026-11-18T00:00:00Z'))!.active).toBe(false);
});

test('an empty repository has no commits, and a folder that is not a repository\'s own is refused', () => {
  const empty = join(scratch, 'empty');
  mkdirSync(empty);
  git(empty, ['init', '-q', '-b', 'main']);
  expect(readCommits(empty)).toEqual({ ok: true, commits: [] });
  expect(readRepo(empty, OWNER)).toBe('');
  expect(repo(empty)).toMatchObject({ first: '', last: '', commits: 0, active: false });

  // A plain folder inside a repository with commits: git would read the repository around it, so it is refused.
  const outer = join(scratch, 'outer');
  mkdirSync(join(outer, 'docs'), { recursive: true });
  git(outer, ['init', '-q', '-b', 'main']);
  commit(outer, 'a.txt', { name: 'Avery Lindqvist', email: 'avery@lindqvist.example' }, '2025-01-01T10:00:00Z');
  expect(readCommits(join(outer, 'docs'))).toEqual({ ok: false, error: `${join(outer, 'docs')} is not the folder of a git repository on this machine.` });
  // A broken .git inside that repository: git is not let look above the folder for another one.
  mkdirSync(join(outer, 'broken', '.git'), { recursive: true });
  const broken = readCommits(join(outer, 'broken'));
  expect(broken.ok).toBe(false);
  if (!broken.ok) expect(broken.error).toContain('not a git repository');
  // An empty path, a file, a folder that is not there.
  expect(readCommits('')).toEqual({ ok: false, error: 'Give the path of a repository.' });
  expect(readCommits('  ')).toEqual({ ok: false, error: 'Give the path of a repository.' });
  writeFileSync(join(scratch, 'file.txt'), 'x');
  expect(readCommits(join(scratch, 'file.txt')).ok).toBe(false);
  expect(readRepo(join(scratch, 'missing'), OWNER)).toBe(`${join(scratch, 'missing')} is not the folder of a git repository on this machine.`);
  // With no identity of the owner's, nothing is read or stored.
  expect(readRepo(outer, [], {}, 1, 'no-owner')).toBe('Give at least one of the owner’s commit emails.');
  expect(readRepo(outer, ['', ' '], {}, 1, 'no-owner')).toBe('Give at least one of the owner’s commit emails.');
  expect(repo('no-owner')).toBe(null);
});

// ---------- Stored readings ----------

test('a new reading replaces the last, keeps its tie unless told, and a deleted project or role unties it', () => {
  const project = (db.query("INSERT INTO projects (role_id, title) VALUES (1, 'Dispatch console') RETURNING id").get() as { id: number }).id;
  expect(recordRepo('https://git.example/harborlight/console', { first: '2023-01-05T10:00:00Z', last: '2026-10-01T10:00:00Z', commits: 120 }, { roleId: 1, projectId: project }, 1)).toBe('');
  expect(recordRepo('https://git.example/harborlight/console', { first: '2023-01-05T10:00:00Z', last: '2026-11-01T10:00:00Z', commits: 124 }, {}, 2)).toBe('');
  expect(repo('https://git.example/harborlight/console', Date.parse('2026-11-18T00:00:00Z'))).toEqual({ key: 'https://git.example/harborlight/console', roleId: 1, projectId: project, first: '2023-01-05T10:00:00Z', last: '2026-11-01T10:00:00Z', commits: 124, readAt: 2, active: true });
  expect(recordRepo('/work/old-tool', { first: '2019-01-01T10:00:00Z', last: '2019-06-01T10:00:00Z', commits: 8 }, {}, 3)).toBe('');
  expect(repoActivity(Date.parse('2026-11-18T00:00:00Z')).map((r) => [r.key, r.active])).toEqual([['https://git.example/harborlight/console', true], ['/work/old-tool', false]]);
  expect(recordRepo(' ', { first: '', last: '', commits: 0 })).toBe('A repository needs a key: its URL or its path.');
  expect(recordRepo('x', { first: '', last: '', commits: 0 }, { roleId: 99 })).toBe('That role is not in the record.');
  expect(recordRepo('x', { first: '', last: '', commits: 0 }, { projectId: 9999 })).toBe('That project is not in the record.');
  db.query('DELETE FROM projects WHERE id = ?').run(project);
  expect(repo('https://git.example/harborlight/console')).toMatchObject({ roleId: 1, projectId: null });
  db.run('DELETE FROM roles WHERE id = 1');
  expect(repo('https://git.example/harborlight/console')).toMatchObject({ roleId: null, projectId: null, commits: 124 });
});
