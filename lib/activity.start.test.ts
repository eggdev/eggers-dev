// `bun test lib`: how the log of slow work starts (lib/activity.ts). The server and the worker each make its triggers
// when they start, often at the same moment, on one database; and a database from before the log, with work already in
// hand, gets one row for each piece of it, and nothing else. Each start is a separate process on a scratch database.
// Everything in it is invented.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'egg-activity-start-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const lib = import.meta.dir;

// Starts one process that opens the database as the server and the worker do; its exit code and what it printed.
async function start(file: string, code: string) {
  const p = Bun.spawn(['bun', '-e', code], { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  const [exit, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { exit, out, err: err.slice(-400) };
}
const OPEN = `await import('${lib}/activity.ts');`;

test('two processes that start together on one database both start, every time', async () => {
  const file = join(dir, 'together.db');
  for (let round = 0; round < 10; round++) {
    const both = await Promise.all([start(file, OPEN), start(file, OPEN)]);
    expect(both.map((b) => (b.exit === 0 ? 'started' : `failed: ${b.err}`))).toEqual(['started', 'started']);
  }
}, 120_000);

test('a database from before the log, with work in hand in every table, gets one row for each piece in hand and no news', async () => {
  const file = join(dir, 'before.db');
  // The tables as the app makes them, without the log: db.ts and talk.ts only.
  const made = await start(file, `await import('${lib}/db.ts'); await import('${lib}/talk.ts');`);
  expect(made.exit).toBe(0);
  const d = new Database(file);
  for (const status of ['queued', 'running', 'done', 'failed']) d.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', ?, 'Invented.', ?, 1)").run(`Source ${status}`, status);
  const states = ['queued', 'running', 'done', 'failed'];
  for (const [i, status] of states.entries()) {
    // A posting in each state; and on read postings, a resume and drafted messages in each state.
    d.query("INSERT INTO jobs (posting, title, company, status, created_at) VALUES ('Invented.', 'Engineer', 'Initech', ?, 1)").run(status);
    d.query("INSERT INTO jobs (posting, title, company, status, resume_status, outreach_status, created_at) VALUES ('Invented.', 'Engineer', 'Globex', 'done', ?, ?, 1)").run(states[i], states[i]);
    d.query("INSERT INTO talk (who, status, created_at) VALUES ('claude', ?, 1)").run(status);
  }
  d.run("UPDATE profile SET status = 'running' WHERE id = 1");
  d.run("UPDATE discovery SET status = 'queued' WHERE id = 1");
  d.close();
  // Started twice, as the server and the worker would be.
  expect((await start(file, OPEN)).exit).toBe(0);
  expect((await start(file, OPEN)).exit).toBe(0);
  const seen = await start(file, `const a = await import('${lib}/activity.ts'); const { db } = await import('${lib}/db.ts');
    console.log(JSON.stringify({ rows: db.query('SELECT kind, subject, state FROM activity ORDER BY kind, subject').all(), digest: a.activity(Date.now()).digest }));`);
  expect(seen.exit).toBe(0);
  const { rows, digest } = JSON.parse(seen.out) as { rows: { kind: string; subject: number; state: string }[]; digest: unknown[] };
  // Ids: sources 1-4 (queued, running, done, failed); jobs 1, 3, 5, 7 hold the postings, 2, 4, 6, 8 the resumes and
  // messages, in the same order of states; talk 1-4.
  expect(rows).toEqual([
    { kind: 'check-watchlist', subject: 1, state: 'waiting' },
    { kind: 'draft-messages', subject: 2, state: 'waiting' }, { kind: 'draft-messages', subject: 4, state: 'running' },
    { kind: 'read-posting', subject: 1, state: 'waiting' }, { kind: 'read-posting', subject: 3, state: 'running' },
    { kind: 'read-source', subject: 1, state: 'waiting' }, { kind: 'read-source', subject: 2, state: 'running' },
    { kind: 'write-profile', subject: 1, state: 'running' },
    { kind: 'write-reply', subject: 1, state: 'waiting' }, { kind: 'write-reply', subject: 2, state: 'running' },
    { kind: 'write-resume', subject: 2, state: 'waiting' }, { kind: 'write-resume', subject: 4, state: 'running' },
  ]);
  expect(digest).toEqual([]);
}, 60_000);
