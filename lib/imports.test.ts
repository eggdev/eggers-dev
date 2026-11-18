// `bun test lib`: the modules that read no database must not open one when they are imported. A tool or a one-off script
// that imports only these (the resume's text, its entries, its metrics, numbers, the timeline, the writing rules) must
// never create or touch a database file. Each is imported in a process of its own, with DB set to a path in a new
// empty folder, and the folder must still be empty afterwards. The list is the modules of lib/ that opened no database
// on import at commit a32e6ce, and the one module added since that reads none (numbers.ts).
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PURE = ['ats', 'entries', 'github', 'llm', 'metrics', 'numbers', 'paths', 'pdf', 'place', 'public', 'resume', 'skim', 'timeline', 'tree', 'writing'];
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Imports one module in a process of its own, with DB in a new empty folder; gives what the folder holds afterwards.
function importAlone(name: string): { exit: number; err: string; db: boolean; left: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'egg-imports-'));
  dirs.push(dir);
  const db = join(dir, 'egg.db');
  const run = Bun.spawnSync(['bun', '-e', `await import('${join(import.meta.dir, `${name}.ts`)}');`], { env: { ...process.env, DB: db, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  return { exit: run.exitCode, err: run.exitCode === 0 ? '' : run.stderr.toString().slice(-300), db: existsSync(db), left: readdirSync(dir) };
}

test('importing a module that reads no database creates no database file', () => {
  for (const name of PURE) expect([name, importAlone(name)]).toEqual([name, { exit: 0, err: '', db: false, left: [] }]);
}, 120_000);

test('the check can see it: a module that opens the database creates the file at DB', () => {
  expect(importAlone('person')).toMatchObject({ exit: 0, db: true });
}, 60_000);
