// The backups of the studio's data in the private R2 bucket (binding DATA, bucket eggers-studio-data), and what
// each one records. The keeper (cloud/keeper.ts), the Worker's backup gateway (studio/worker/backups.ts) and the
// owner's tools (cloud/tools/) all name objects with these functions, so the three always agree.
//
// In the bucket:
//   backups/<time>.tar.gz   one backup: the database, the data folder's files and the Codex sign-in
//   backups/<time>.json     its manifest (below), written when its upload is complete
//   latest.json             the manifest of the backup to restore, written last
// <time> is the backup's UTC time in ISO form with ':' and '.' replaced by '-', so names sort by time.
// This file has no imports: the Worker bundles it too.

export const PREFIX = 'backups/';
export const POINTER = 'latest.json';
export const FORMAT = 1;

export type DbStats = {
  /** The size of the consistent copy of the database (VACUUM INTO), in bytes. */
  bytes: number;
  roles: number;
  facts: number;
  jobs: number;
};

export type Manifest = {
  format: typeof FORMAT;
  /** The archive's object key: backups/<time>.tar.gz. */
  key: string;
  /** When the backup was taken, in milliseconds since 1970. */
  createdAt: number;
  /** The archive's size in bytes. */
  size: number;
  /** The archive's SHA-256, in lowercase hex. */
  sha256: string;
  db: DbStats;
  /** The number of files in the archive, the database included. */
  files: number;
  /** What made it: the keeper in the container, or the owner's first upload (cloud/tools/seed.ts). */
  from: 'keeper' | 'seed';
};

const KEY = /^backups\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz$/;

/** The archive key for a backup taken at this time. */
export function backupKey(at: number): string {
  return `${PREFIX}${new Date(at).toISOString().replace(/[:.]/g, '-')}.tar.gz`;
}

/** Whether a key is a backup archive's key, and nothing else (no other folder, no "..", no other name). */
export const isBackupKey = (key: string) => KEY.test(key);

/** The manifest key that belongs to an archive key. */
export const manifestKey = (key: string) => key.replace(/\.tar\.gz$/, '.json');

const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The manifest in a parsed JSON value, or null when any field is missing or not in its form. */
export function parseManifest(value: unknown): Manifest | null {
  const m = value as Partial<Manifest> | null;
  if (!m || typeof m !== 'object') return null;
  if (m.format !== FORMAT || typeof m.key !== 'string' || !isBackupKey(m.key)) return null;
  if (!count(m.createdAt) || !count(m.size) || typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
  const db = m.db as Partial<DbStats> | undefined;
  if (!db || !count(db.bytes) || !count(db.roles) || !count(db.facts) || !count(db.jobs)) return null;
  if (!count(m.files) || (m.from !== 'keeper' && m.from !== 'seed')) return null;
  return {
    format: FORMAT, key: m.key, createdAt: m.createdAt!, size: m.size!, sha256: m.sha256,
    db: { bytes: db.bytes!, roles: db.roles!, facts: db.facts!, jobs: db.jobs! }, files: m.files!, from: m.from,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Retention

export const KEEP_NEWEST = 30;
export const KEEP_DAYS = 30;
const DAY = 86_400_000;

/**
 * The archive keys to delete: everything except the newest KEEP_NEWEST backups, the newest backup of each UTC day
 * in the last KEEP_DAYS days, and the key the pointer names (never deleted, however old).
 */
export function toPrune(backups: { key: string; createdAt: number }[], now: number, keep: string | null): string[] {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : -1));
  const kept = new Set<string>(sorted.slice(0, KEEP_NEWEST).map((b) => b.key));
  const days = new Set<string>();
  for (const b of sorted) {
    if (now - b.createdAt > KEEP_DAYS * DAY) continue;
    const day = new Date(b.createdAt).toISOString().slice(0, 10);
    if (days.has(day)) continue;
    days.add(day);
    kept.add(b.key);
  }
  if (keep) kept.add(keep);
  return sorted.filter((b) => !kept.has(b.key)).map((b) => b.key);
}

// ---------------------------------------------------------------------------------------------------------------
// The shrink guard

/**
 * Whether a new backup may replace the one the pointer names. A database under half the size of the last one, or
 * with no roles or no facts where the last one had some, looks like a wrong or empty database: refused unless the
 * owner allows it (EGG_ALLOW_SHRINK=1).
 */
export function shrinkCheck(last: DbStats | null, next: DbStats, allow: boolean): { ok: true; warning?: string } | { ok: false; reason: string } {
  if (!last) return { ok: true };
  const problems: string[] = [];
  if (next.bytes * 2 < last.bytes) problems.push(`the database is ${next.bytes} bytes; the last backup's was ${last.bytes}`);
  if (last.roles > 0 && next.roles === 0) problems.push(`it has no roles; the last backup had ${last.roles}`);
  if (last.facts > 0 && next.facts === 0) problems.push(`it has no facts; the last backup had ${last.facts}`);
  if (problems.length === 0) return { ok: true };
  const reason = `the new backup looks much smaller than the last one: ${problems.join('; ')}`;
  return allow ? { ok: true, warning: `${reason} (allowed by EGG_ALLOW_SHRINK=1)` } : { ok: false, reason };
}
