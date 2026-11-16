// The database checks the keeper and the owner's tools need: a consistent copy taken while the app runs, the
// integrity check, the row counts a backup records, and whether the worker has work in hand.
// None of these writes to the app's database: they only read it. Copies and checks open their own connections.
import { Database } from 'bun:sqlite';
import { existsSync, rmSync, statSync } from 'node:fs';
import type { DbStats } from './manifest.ts';

// The app's own setting (lib/db.ts): a lock held by the server or the worker is waited for, not failed on.
const BUSY_TIMEOUT_MS = 5000;

// The app's database is opened read-write but never created, and only read. A read-only connection cannot open a
// WAL database whose -shm file is gone (the app deletes it when its last connection closes), which happens before
// the app starts and whenever it is stopped.
function open(path: string): Database {
  const db = new Database(path, { readwrite: true, create: false });
  db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}

/**
 * Opens a database file that no app has open (a copy, or a database just unpacked) to read it. A file in WAL mode
 * cannot be opened read-only without its -shm file, so this opens it read-write, never creating it, and removes the
 * -wal and -shm files that the connection made.
 */
function openFile<T>(path: string, use: (db: Database) => T): T {
  const had = ['-wal', '-shm'].filter((side) => existsSync(`${path}${side}`));
  const db = new Database(path, { readwrite: true, create: false });
  try {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return use(db);
  } finally {
    db.close();
    for (const side of ['-wal', '-shm']) if (!had.includes(side)) rmSync(`${path}${side}`, { force: true });
  }
}

/**
 * Writes a consistent copy of the database to `out` without stopping the app. VACUUM INTO reads one snapshot of the
 * database (WAL included) in one read transaction, so writes that the server or the worker make meanwhile are either
 * all in the copy or not in it. The copy is one compact file with no -wal or -shm beside it.
 */
export function copyDatabase(path: string, out: string): void {
  if (!existsSync(path)) throw new Error(`there is no database at ${path}`);
  rmSync(out, { force: true });
  const db = open(path);
  try {
    db.query('VACUUM INTO ?').run(out);
  } finally {
    db.close();
  }
  // The copy is in rollback-journal mode. The app switches every database to WAL when it opens it (lib/db.ts),
  // and that switch is a change: the copy is switched here, so a restored database is the same file the app
  // keeps, and a wake with no change makes no backup.
  const copy = new Database(out);
  try {
    copy.run('PRAGMA journal_mode = WAL');
  } finally {
    copy.close();
  }
  for (const side of ['-wal', '-shm']) rmSync(`${out}${side}`, { force: true });
}

/** SQLite's own integrity check of a database file: ok, or the first problems it names. */
export function checkDatabase(path: string): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(path)) return { ok: false, reason: 'the database file is missing' };
  if (statSync(path).size === 0) return { ok: false, reason: 'the database file is empty' };
  try {
    const said = openFile(path, (db) => (db.query('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check));
    return said.length === 1 && said[0] === 'ok' ? { ok: true } : { ok: false, reason: `integrity_check: ${said.slice(0, 3).join('; ')}` };
  } catch (error) {
    return { ok: false, reason: `the database cannot be read (${(error as Error).message})` };
  }
}

const countOf = (db: Database, table: string) => {
  try {
    return (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    // A table that is not there yet (an older or a new, empty database) has no rows.
    return 0;
  }
};

/** The size and row counts a backup records, from a copy or an unpacked file. Only counts: no row's content is read. */
export function statsOf(path: string): DbStats {
  const bytes = statSync(path).size;
  return openFile(path, (db) => ({ bytes, roles: countOf(db, 'roles'), facts: countOf(db, 'facts'), jobs: countOf(db, 'jobs') }));
}

// The queues the worker takes work from (worker.ts), each as the condition under which it will take a row.
const WORK = [
  "SELECT 1 FROM sources WHERE status IN ('queued', 'running') LIMIT 1",
  "SELECT 1 FROM profile WHERE status IN ('queued', 'running') LIMIT 1",
  "SELECT 1 FROM jobs WHERE status IN ('queued', 'running') LIMIT 1",
  "SELECT 1 FROM jobs WHERE (resume_status = 'queued' AND status = 'done') OR resume_status = 'running' LIMIT 1",
  "SELECT 1 FROM jobs WHERE outreach_status IN ('queued', 'running') LIMIT 1",
  "SELECT 1 FROM talk WHERE status IN ('queued', 'running') LIMIT 1",
  "SELECT 1 FROM discovery WHERE status IN ('queued', 'running') LIMIT 1",
];

/** A read-only connection the keeper keeps open: the app's busy state and SQLite's change counter. */
export class Watcher {
  private db: Database | null = null;
  constructor(private readonly path: string) {}

  private conn(): Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    try {
      this.db = open(this.path);
    } catch {
      return null;
    }
    return this.db;
  }

  /** Whether any queue has a row queued or running. A table that is not there is no work. */
  busy(): boolean {
    const db = this.conn();
    if (!db) return false;
    return WORK.some((sql) => {
      try {
        return db.query(sql).get() !== null;
      } catch {
        return false;
      }
    });
  }

  /** SQLite's data_version: it changes when another connection commits a change to the database. */
  dataVersion(): number {
    const db = this.conn();
    if (!db) return -1;
    try {
      return (db.query('PRAGMA data_version').get() as { data_version: number }).data_version;
    } catch {
      return -1;
    }
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}
