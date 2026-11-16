// Restore: the first thing the keeper does, before the app may start. The rule that matters most: the app never
// starts on an empty or partial database by accident, because the keeper would then back that up over the owner's
// data. So:
//   - a backup is used only after its checksum, its paths and SQLite's integrity check all pass;
//   - a backup that fails is skipped for the one before it;
//   - "no backup yet" counts only when the store answers that it holds none, and starts empty only when the owner
//     allows it (EGG_ALLOW_EMPTY=1);
//   - a store that cannot be reached is asked again, with a growing wait, and never read as "no backup".
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DB_IN_ARCHIVE, placeUnpacked, sha256File, unpackArchive, type Layout } from './archive.ts';
import type { Manifest } from './manifest.ts';
import { checkDatabase, statsOf } from './sqlite.ts';
import type { Store } from './store.ts';

export type RestoreResult =
  | { kind: 'restored'; manifest: Manifest; skipped: string[] }
  | { kind: 'empty' }
  | { kind: 'refused'; reason: string; retry: boolean };

export type RestoreDeps = {
  store: Store;
  layout: Layout;
  /** A folder for downloads and unpacking, outside the data folder. */
  work: string;
  allowEmpty: boolean;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** How many times the store's index is asked for before giving up (the keeper asks again later). */
  indexAttempts?: number;
  /** How many times one backup's download is tried before the previous backup is tried instead. */
  downloadAttempts?: number;
  /** The wait after the first failure; it doubles up to maxWaitMs. */
  firstWaitMs?: number;
  maxWaitMs?: number;
};

/** Checks one downloaded archive against its manifest and SQLite, and unpacks it into `unpackInto`. Throws on any failure. */
export async function verifyArchive(file: string, manifest: Manifest, unpackInto: string): Promise<void> {
  const size = statSync(file).size;
  if (size !== manifest.size) throw new Error(`the archive is ${size} bytes; its manifest says ${manifest.size}`);
  const sum = await sha256File(file);
  if (sum !== manifest.sha256) throw new Error('the archive does not match the checksum in its manifest');
  unpackArchive(file, unpackInto);
  const db = join(unpackInto, DB_IN_ARCHIVE);
  if (!existsSync(db)) throw new Error('the archive has no database');
  const check = checkDatabase(db);
  if (!check.ok) throw new Error(`the database in the archive fails its check: ${check.reason}`);
  const stats = statsOf(db);
  if (stats.roles !== manifest.db.roles || stats.facts !== manifest.db.facts || stats.jobs !== manifest.db.jobs) {
    throw new Error('the database in the archive does not have the row counts its manifest records');
  }
}

export async function restore(d: RestoreDeps): Promise<RestoreResult> {
  const sleep = d.sleep ?? ((ms: number) => Bun.sleep(ms));
  const first = d.firstWaitMs ?? 2_000;
  const max = d.maxWaitMs ?? 60_000;
  const backoff = (attempt: number) => Math.min(first * 2 ** attempt, max);

  if (existsSync(d.layout.db)) {
    return { kind: 'refused', retry: false, reason: `the data folder already holds a database (${d.layout.db}); the keeper restores only into an empty data folder` };
  }

  // 1. What the store holds. Only a successful answer counts.
  let index: Awaited<ReturnType<Store['index']>> | null = null;
  const attempts = d.indexAttempts ?? Infinity;
  for (let i = 0; i < attempts; i++) {
    try {
      index = await d.store.index();
      break;
    } catch (error) {
      d.log(`restore: the backup store cannot be read (${(error as Error).message}); asking again in ${backoff(i) / 1000} s`);
      if (i + 1 < attempts) await sleep(backoff(i));
    }
  }
  if (!index) return { kind: 'refused', retry: true, reason: 'the backup store could not be reached' };

  // 2. The backups to try: the one the pointer names, then every other one, newest first.
  const candidates: Manifest[] = [];
  if (index.latest) candidates.push(index.latest);
  for (const m of index.backups) if (!candidates.some((c) => c.key === m.key)) candidates.push(m);
  if (candidates.length === 0) {
    if (d.allowEmpty) {
      d.log('restore: the store holds no backup yet, and EGG_ALLOW_EMPTY=1: starting with an empty data folder');
      return { kind: 'empty' };
    }
    return { kind: 'refused', retry: false, reason: 'the store holds no backup yet. Upload the first one with cloud/tools/seed.ts, or start empty once with EGG_ALLOW_EMPTY=1' };
  }
  if (!index.latest) d.log('restore: the store has backups but no pointer (latest.json); trying the newest backup');

  // 3. The first candidate that downloads and passes every check.
  mkdirSync(d.work, { recursive: true });
  const skipped: string[] = [];
  for (const m of candidates) {
    const file = join(d.work, 'restore.tar.gz');
    const unpacked = join(d.work, 'restore');
    let ok = false;
    for (let i = 0; i < (d.downloadAttempts ?? 3) && !ok; i++) {
      rmSync(file, { force: true });
      rmSync(unpacked, { recursive: true, force: true });
      try {
        await d.store.download(m.key, file);
        await verifyArchive(file, m, unpacked);
        ok = true;
      } catch (error) {
        d.log(`restore: ${m.key} cannot be used (${(error as Error).message})`);
        if (i + 1 < (d.downloadAttempts ?? 3)) await sleep(backoff(i));
      }
    }
    if (!ok) {
      skipped.push(m.key);
      continue;
    }
    placeUnpacked(unpacked, d.layout);
    rmSync(file, { force: true });
    rmSync(unpacked, { recursive: true, force: true });
    d.log(`restore: restored ${m.key} (${m.size} bytes, ${m.db.roles} roles, ${m.db.facts} facts, ${m.db.jobs} jobs)${skipped.length ? `; skipped ${skipped.length} that failed` : ''}`);
    return { kind: 'restored', manifest: m, skipped };
  }
  return { kind: 'refused', retry: true, reason: `none of the ${candidates.length} backups could be restored; the app was not started` };
}
