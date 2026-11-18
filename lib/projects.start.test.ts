// `bun test lib`: how the record's tree starts (lib/db.ts's triggers and lib/projects.ts). The server and the worker
// each open the database and give project-like rows their project when they start, often at the same moment, on one
// database. Each start is a separate process on a scratch database made with the old schema. Everything is invented.
import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oldTreeDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-projects-start-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const lib = import.meta.dir;

async function start(file: string, code: string) {
  const p = Bun.spawn(['bun', '-e', code], { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  const [exit, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { exit, out, err: err.slice(-400) };
}
// As the server and the worker start: the record's tables and triggers, the log of slow work (which now follows a
// role's request for suggested projects), and the stage 2 modules.
const OPEN = `await import('${lib}/db.ts'); await import('${lib}/projects.ts'); await import('${lib}/activity.ts'); await import('${lib}/gaps.ts'); await import('${lib}/derived.ts'); await import('${lib}/propose.ts'); await import('${lib}/queue.ts');`;

test('two processes that start together on an old database both start, every time, and each row gets one project', async () => {
  const file = join(dir, 'together.db');
  oldTreeDatabase(file);
  for (let round = 0; round < 10; round++) {
    const both = await Promise.all([start(file, OPEN), start(file, OPEN)]);
    expect(both.map((b) => (b.exit === 0 && !b.out.includes('could not') ? 'started' : `failed: ${b.err}${b.out}`))).toEqual(['started', 'started']);
  }
  const d = new Database(file, { readonly: true });
  expect(d.query('SELECT via_role FROM projects ORDER BY id').all()).toEqual([{ via_role: 3 }, { via_role: 4 }, { via_role: 5 }]);
  // The triggers are there once each, made again at every start. The one that cleared a role's marks is gone: no mark
  // of where a value came from is kept any more (the owner, 2026-11-18).
  expect(d.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('roles_mark_cleared', 'roles_id_floor', 'facts_id_floor', 'roles_id_above_floor') ORDER BY name").all())
    .toEqual([{ name: 'facts_id_floor' }, { name: 'roles_id_above_floor' }, { name: 'roles_id_floor' }]);
  d.close();
}, 120_000);

// As the worker and a page load check the questions at once: each step on its own, as worker.ts does it, so one
// that fails does not skip the others. Neither may fail with "database is locked".
const SYNC = `${OPEN} const { syncQuestions } = await import('${lib}/checks.ts'); const { syncRecordQuestions } = await import('${lib}/gaps.ts');
  for (const [name, run] of [['questions', () => syncQuestions(Date.now())], ['record', () => syncRecordQuestions(Date.now())]]) {
    try { run(); } catch (e) { console.log(name + ' could not be checked: ' + e.message); }
  }`;

test('two processes that check the questions together never fail with a locked database', async () => {
  for (let round = 0; round < 6; round++) {
    const file = join(dir, `sync-${round}.db`);
    oldTreeDatabase(file);
    const both = await Promise.all([start(file, SYNC), start(file, SYNC)]);
    expect(both.map((b) => (b.exit === 0 && !b.out.includes('could not') && !`${b.out}${b.err}`.includes('locked') ? 'checked' : `failed: ${b.err}${b.out}`))).toEqual(['checked', 'checked']);
    // And again on the same database, now that the questions are there.
    const again = await Promise.all([start(file, SYNC), start(file, SYNC)]);
    expect(again.map((b) => (b.exit === 0 && !b.out.includes('could not') ? 'checked' : `failed: ${b.err}${b.out}`))).toEqual(['checked', 'checked']);
  }
}, 180_000);

// Two processes that list a skill no process has listed yet, at the same moment (Home in one, the worker in the other).
// Neither may fail: not with a second row for the same skill, nor with a locked database.
const SKILLS = `${OPEN} const { db } = await import('${lib}/db.ts'); const { syncSkills } = await import('${lib}/skills.ts');
  try { syncSkills(Date.now()); } catch (e) { console.log('skills could not be listed: ' + e.message); }`;

test('two processes that list a new skill together both list it, once', async () => {
  const file = join(dir, 'skills.db');
  oldTreeDatabase(file);
  for (let round = 0; round < 6; round++) {
    const d = new Database(file);
    d.query("INSERT INTO facts (id, role_id, kind, text, skills, created_at) VALUES (?, 1, 'other', ?, ?, 1)").run(100 + round, `An invented fact ${round}.`, `Invented Tool ${round}`);
    d.close();
    const both = await Promise.all([start(file, SKILLS), start(file, SKILLS)]);
    expect(both.map((b) => (b.exit === 0 && !b.out.includes('could not') ? 'listed' : `failed: ${b.err}${b.out}`))).toEqual(['listed', 'listed']);
  }
  const d = new Database(file, { readonly: true });
  expect(d.query("SELECT key, facts FROM skills WHERE key LIKE 'invented tool%' ORDER BY key").all()).toEqual(Array.from({ length: 6 }, (_, i) => ({ key: `invented tool ${i}`, facts: 1 })));
  d.close();
}, 120_000);

test('with nothing to do, giving rows their projects writes nothing', async () => {
  const file = join(dir, 'idle.db');
  oldTreeDatabase(file);
  expect((await start(file, OPEN)).exit).toBe(0);
  const seen = await start(file, `${OPEN} const { db } = await import('${lib}/db.ts'); const { syncProjects } = await import('${lib}/projects.ts');
    const before = db.query('SELECT total_changes() AS n').get().n; const made = syncProjects(); console.log(JSON.stringify({ made, changes: db.query('SELECT total_changes() AS n').get().n - before }));`);
  expect(seen.exit).toBe(0);
  expect(JSON.parse(seen.out.trim().split('\n').pop()!)).toEqual({ made: 0, changes: 0 });
});
