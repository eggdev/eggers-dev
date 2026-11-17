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
const OPEN = `await import('${lib}/db.ts'); await import('${lib}/projects.ts');`;

test('two processes that start together on an old database both start, every time, and each row gets one project', async () => {
  const file = join(dir, 'together.db');
  oldTreeDatabase(file);
  for (let round = 0; round < 10; round++) {
    const both = await Promise.all([start(file, OPEN), start(file, OPEN)]);
    expect(both.map((b) => (b.exit === 0 && !b.out.includes('could not') ? 'started' : `failed: ${b.err}${b.out}`))).toEqual(['started', 'started']);
  }
  const d = new Database(file, { readonly: true });
  expect(d.query('SELECT via_role FROM projects ORDER BY id').all()).toEqual([{ via_role: 3 }, { via_role: 4 }, { via_role: 5 }]);
  // The triggers are there once each, made again at every start.
  expect(d.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('roles_mark_cleared', 'roles_id_floor', 'facts_id_floor', 'roles_id_above_floor') ORDER BY name").all())
    .toEqual([{ name: 'facts_id_floor' }, { name: 'roles_id_above_floor' }, { name: 'roles_id_floor' }, { name: 'roles_mark_cleared' }]);
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
