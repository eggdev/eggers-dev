// Taking a backup: a consistent copy of the database, checked, packed with the data folder's files and the Codex
// sign-in, and sent to the store. The pointer (latest.json) moves to the new backup only after its upload is
// complete, so a half-written upload is never the one to restore. Used by the keeper and by cloud/tools/seed.ts.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildArchive, filesToKeep, type Layout } from './archive.ts';
import { backupKey, FORMAT, shrinkCheck, type DbStats, type Manifest } from './manifest.ts';
import { checkDatabase, copyDatabase, statsOf } from './sqlite.ts';
import type { Store } from './store.ts';

export type Prepared = { file: string; manifest: Manifest; warning?: string };
export type PrepareResult = { kind: 'ready'; prepared: Prepared } | { kind: 'refused'; reason: string };

export type PrepareOpts = {
  layout: Layout;
  /** A folder for the copy and the archive, outside the data folder (or named in layout.skip). */
  work: string;
  from: Manifest['from'];
  /** The database stats of the backup the pointer names now, for the shrink guard; null when there is none. */
  last: DbStats | null;
  allowShrink: boolean;
  now: number;
};

/** The archive and manifest of a new backup, or why there must be none. Nothing is sent. */
export async function prepareBackup(o: PrepareOpts): Promise<PrepareResult> {
  mkdirSync(o.work, { recursive: true });
  const copy = join(o.work, 'copy.db');
  try {
    // The file list first: a file that appears after it waits for the next backup, which the change it
    // made will cause.
    const files = filesToKeep({ ...o.layout, skip: [...(o.layout.skip ?? []), o.work] });
    copyDatabase(o.layout.db, copy);
    const check = checkDatabase(copy);
    if (!check.ok) return { kind: 'refused', reason: `the database copy fails its check (${check.reason}); nothing was uploaded` };
    const db = statsOf(copy);
    const guard = shrinkCheck(o.last, db, o.allowShrink);
    if (!guard.ok) return { kind: 'refused', reason: `${guard.reason}. Nothing was uploaded. Set EGG_ALLOW_SHRINK=1 if this is intended` };
    const key = backupKey(o.now);
    const file = join(o.work, 'backup.tar.gz');
    const built = await buildArchive({ dbCopy: copy, files, out: file, work: o.work });
    const manifest: Manifest = { format: FORMAT, key, createdAt: o.now, size: built.size, sha256: built.sha256, db, files: built.files, from: o.from };
    return { kind: 'ready', prepared: { file, manifest, ...(guard.warning ? { warning: guard.warning } : {}) } };
  } finally {
    rmSync(copy, { force: true });
  }
}

/** Uploads a prepared backup, then moves the pointer to it. The pointer is written last. */
export async function sendBackup(store: Store, p: Prepared): Promise<void> {
  try {
    await store.upload(p.file, p.manifest);
    await store.commit(p.manifest.key);
  } finally {
    rmSync(p.file, { force: true });
  }
}
