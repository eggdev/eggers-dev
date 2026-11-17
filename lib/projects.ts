// Gives every project-like `roles` row (a repository's project group, a side project, a repository nobody placed) one
// project that points at it (`via_role`). It runs when this module is imported (server.ts and worker.ts), after a
// change to the roles (server.ts's `follow`) and after repositories are filed (worker.ts, after `associate`).
// It is safe to run again and again: it adds a project only where none points at the row yet, and takes away only a
// project whose row is gone. It never changes a role or a fact, so the record's signature stays as it was and no
// resume is written again because of it.
import { db, type RoleRow } from './db.ts';
import { levelOf } from './tree.ts';

// What is to be done, read without a write lock: the project-like rows with no project, and the projects whose row is gone.
function pending(): { missing: number[]; orphans: number } {
  const rows = db.query('SELECT * FROM roles').all() as RoleRow[];
  const carried = new Set((db.query('SELECT via_role FROM projects WHERE via_role IS NOT NULL').all() as { via_role: number }[]).map((p) => p.via_role));
  const ids = new Set(rows.map((r) => r.id));
  return { missing: rows.filter((r) => levelOf(r, rows) !== 'role' && !carried.has(r.id)).map((r) => r.id), orphans: [...carried].filter((id) => !ids.has(id)).length };
}

export function syncProjects(now = Date.now()): number {
  // Nothing to do (the usual case, on every read of the tree): no write and no write lock.
  const first = pending();
  if (first.missing.length === 0 && first.orphans === 0) return 0;
  // The write takes the lock first (immediate) and looks again under it: the server and the worker may both get here.
  return db.transaction(() => {
    // Not INSERT OR IGNORE: an ignored insert still uses up a number, and a P- reference would skip one.
    const add = db.query('INSERT INTO projects (via_role, created_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM projects WHERE via_role = ?)');
    let made = 0;
    for (const id of pending().missing) made += add.run(id, now, id).changes;
    db.run('DELETE FROM projects WHERE via_role IS NOT NULL AND via_role NOT IN (SELECT id FROM roles)');
    return made;
  }).immediate();
}

// At start a failure (the database busy past its timeout) must not stop the process: the next read of the tree tries
// again (lib/record.ts, readTree).
try { syncProjects(); } catch (e) { console.log(`projects could not be given their rows yet: ${(e as Error).message}`); }
