// What was read from a repository about the owner's own work in it: their first and last commit, how many commits are
// theirs, and when it was read. Whether a repository is active is worked out when it is read back, never stored, so the
// window can be tuned without touching the data. Nothing calls this yet. Additive only: one new table and its
// triggers, created when this file is imported.
//
// The owner's author identities (their commit emails) are passed in by the caller. None is written in this file.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { db } from './db.ts';

// How recent the owner's last commit must be for a repository to count as active, in calendar months. A value to tune.
export const ACTIVE_MONTHS = 6;

// key: the repository as the caller names it (a URL, a local path, or owner/name). role_id and project_id: what it is
// tied to, when known. first_commit and last_commit: the owner's, as git gave them (ISO 8601), or '' with no commits.
db.run(`CREATE TABLE IF NOT EXISTS repo_activity (
  key TEXT PRIMARY KEY, role_id INTEGER, project_id INTEGER, first_commit TEXT NOT NULL DEFAULT '', last_commit TEXT NOT NULL DEFAULT '',
  commits INTEGER NOT NULL DEFAULT 0, read_at INTEGER NOT NULL DEFAULT 0)`);
// A repository outlives what it was tied to: a deleted project or role leaves it, untied. Created only if missing, so a
// change to a body needs a DROP first to reach an existing database.
db.run('CREATE TRIGGER IF NOT EXISTS repo_activity_project_gone AFTER DELETE ON projects BEGIN UPDATE repo_activity SET project_id = NULL WHERE project_id = OLD.id; END');
db.run('CREATE TRIGGER IF NOT EXISTS repo_activity_role_gone AFTER DELETE ON roles BEGIN UPDATE repo_activity SET role_id = NULL WHERE role_id = OLD.id; END');

export type Commit = { email: string; date: string };
export type CommitSummary = { first: string; last: string; commits: number };

const same = (s: string) => s.trim().toLowerCase();

// Pure: the owner's part of a list of commits. A commit is the owner's when its author email is one of the identities,
// in any case. first and last are compared as instants, so commits made in different time zones fall in true order;
// each is kept as git wrote it. A date that cannot be read still counts as a commit but is not a first or last.
export function summarize(commits: Commit[], identities: string[]): CommitSummary {
  const mine = new Set(identities.map(same).filter((x) => x !== ''));
  let first = '', last = '', firstAt = Infinity, lastAt = -Infinity, n = 0;
  for (const c of commits) {
    if (!mine.has(same(c.email))) continue;
    n++;
    const at = Date.parse(c.date);
    if (Number.isNaN(at)) continue;
    if (at < firstAt) { firstAt = at; first = c.date; }
    if (at > lastAt) { lastAt = at; last = c.date; }
  }
  return { first, last, commits: n };
}

// The instant `months` calendar months before now (UTC). A day the earlier month lacks is its last day: six months
// before 31 August is 28 or 29 February, not 2 or 3 March.
export function monthsBefore(now: number, months: number): number {
  const d = new Date(now);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() - months;
  const y = Math.floor(total / 12), m = total - y * 12;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

// Pure: active when the owner's last commit is at or after the instant `months` calendar months before now. The
// boundary itself counts as active. No last commit is never active.
export function isActive(last: string, now: number, months = ACTIVE_MONTHS): boolean {
  const at = Date.parse(last);
  return !Number.isNaN(at) && at >= monthsBefore(now, months);
}

// How long one `git log` may run before it is stopped.
export const GIT_TIMEOUT_MS = 60_000;

// Every commit of a local repository, on every branch and tag, as author email and author date. Read-only: one
// `git log`. Merge commits are left out: a merge is often made by a tool or a web page, and is not work of its own.
// The stash is left out: its commits are unfinished changes, and one would count as the owner's newest commit.
// The path must be the repository's own folder (it holds .git, as lib/github.ts and lib/ingest.ts check): a folder
// inside a repository, or an empty path, would read the repository around it.
export function readCommits(path: string): { ok: true; commits: Commit[] } | { ok: false; error: string } {
  if (path.trim() === '') return { ok: false, error: 'Give the path of a repository.' };
  const dir = resolve(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory() || !existsSync(join(dir, '.git'))) return { ok: false, error: `${dir} is not the folder of a git repository on this machine.` };
  // An argument list and no shell, so a path is never read as a command. The signature setting is turned off so a
  // signed commit adds no lines to the output. Every GIT_ variable set around this process is dropped: GIT_DIR,
  // GIT_WORK_TREE, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY and the rest would point git at another repository than the path,
  // or make it fail. And git may not look above the path for one (a broken .git would send it to the folder around).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const p = Bun.spawnSync(['git', '-C', dir, '-c', 'log.showSignature=false', 'log', '--exclude=refs/stash', '--all', '--no-merges', '--no-color', '--format=%ae%x09%aI'],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: GIT_TIMEOUT_MS, env: { ...env, GIT_CEILING_DIRECTORIES: dirname(realpathSync(dir)), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
  if (p.exitedDueToTimeout) return { ok: false, error: `git log took longer than ${GIT_TIMEOUT_MS / 1000} seconds and was stopped.` };
  const err = p.stderr.toString().trim();
  if (p.exitCode !== 0) return { ok: false, error: err || `git log stopped with code ${p.exitCode}.` };
  const commits: Commit[] = [];
  for (const line of p.stdout.toString().split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    commits.push({ email: line.slice(0, tab), date: line.slice(tab + 1).trim() });
  }
  return { ok: true, commits };
}

export type RepoActivity = { key: string; roleId: number | null; projectId: number | null; first: string; last: string; commits: number; readAt: number; active: boolean };
type RepoRow = { key: string; role_id: number | null; project_id: number | null; first_commit: string; last_commit: string; commits: number; read_at: number };

// Stores what one reading of a repository found, in place of the last reading. A tie left out keeps the one stored;
// null unties it. Returns '' or why it was refused.
export function recordRepo(key: string, s: CommitSummary, tie: { roleId?: number | null; projectId?: number | null } = {}, now = Date.now()): string {
  const k = key.trim();
  if (k === '') return 'A repository needs a key: its URL or its path.';
  return db.transaction(() => {
    if (tie.roleId != null && db.query('SELECT 1 FROM roles WHERE id = ?').get(tie.roleId) === null) return 'That role is not in the record.';
    if (tie.projectId != null && db.query('SELECT 1 FROM projects WHERE id = ?').get(tie.projectId) === null) return 'That project is not in the record.';
    db.query('INSERT INTO repo_activity (key, first_commit, last_commit, commits, read_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET first_commit = excluded.first_commit, last_commit = excluded.last_commit, commits = excluded.commits, read_at = excluded.read_at')
      .run(k, s.first, s.last, s.commits, now);
    if (tie.roleId !== undefined) db.query('UPDATE repo_activity SET role_id = ? WHERE key = ?').run(tie.roleId, k);
    if (tie.projectId !== undefined) db.query('UPDATE repo_activity SET project_id = ? WHERE key = ?').run(tie.projectId, k);
    return '';
  }).immediate();
}

// Reads a local repository and stores the owner's part of it. Returns '' or why it could not be read. With no identity
// every commit would count as someone else's, and 0 would be stored as if it were known: refused.
export function readRepo(path: string, identities: string[], tie: { roleId?: number | null; projectId?: number | null } = {}, now = Date.now(), key = path): string {
  if (!identities.some((x) => x.trim() !== '')) return 'Give at least one of the owner’s commit emails.';
  const r = readCommits(path);
  if (!r.ok) return r.error;
  return recordRepo(key, summarize(r.commits, identities), tie, now);
}

const toActivity = (r: RepoRow, now: number, months: number): RepoActivity =>
  ({ key: r.key, roleId: r.role_id, projectId: r.project_id, first: r.first_commit, last: r.last_commit, commits: r.commits, readAt: r.read_at, active: isActive(r.last_commit, now, months) });

// Every repository read, the most recent last commit first, each with whether it is active now.
export const repoActivity = (now = Date.now(), months = ACTIVE_MONTHS) =>
  (db.query('SELECT * FROM repo_activity').all() as RepoRow[]).map((r) => toActivity(r, now, months))
    .sort((a, b) => (Date.parse(b.last) || 0) - (Date.parse(a.last) || 0) || a.key.localeCompare(b.key));

export function repo(key: string, now = Date.now(), months = ACTIVE_MONTHS): RepoActivity | null {
  const r = db.query('SELECT * FROM repo_activity WHERE key = ?').get(key.trim()) as RepoRow | null;
  return r ? toActivity(r, now, months) : null;
}
