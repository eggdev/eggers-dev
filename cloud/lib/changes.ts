// When to back up. The keeper reads a cheap signature of the data every few seconds: SQLite's change counter for
// the database (PRAGMA data_version on the keeper's own connection: it changes when the server or the worker
// commits a change, and not when they only open the file or checkpoint the WAL), and the size and time of every
// other file a backup holds. A backup is due
// when the signature differs from the one last saved and has then been still for a quiet period (default 45 s),
// or when the first unsaved change is older than the longest wait (default 5 minutes), so a long run of changes
// is still saved now and then.
import type { Entry } from './archive.ts';

/** A signature of the data: equal signatures mean nothing a backup holds has changed. */
export function signature(dataVersion: number, files: Entry[]): string {
  const hasher = new Bun.CryptoHasher('sha1');
  hasher.update(`db v ${dataVersion}\n`);
  for (const f of files) hasher.update(`${f.rel} ${f.size}:${Math.round(f.mtimeMs)}\n`);
  return hasher.digest('hex');
}

export type TrackerOpts = { quietMs?: number; maxWaitMs?: number };

/** The change state between backups. Pure: the caller passes the time, so tests use their own clock. */
export class ChangeTracker {
  readonly quietMs: number;
  readonly maxWaitMs: number;
  private savedSig: string;
  private current: string;
  private firstChangeAt: number | null = null;
  private lastChangeAt = 0;

  constructor(savedSignature: string, opts: TrackerOpts = {}) {
    this.quietMs = opts.quietMs ?? 45_000;
    this.maxWaitMs = opts.maxWaitMs ?? 5 * 60_000;
    this.savedSig = savedSignature;
    this.current = savedSignature;
  }

  /** Records the signature read now. */
  observe(sig: string, now: number) {
    if (sig === this.current) return;
    this.current = sig;
    this.lastChangeAt = now;
    if (sig === this.savedSig) this.firstChangeAt = null; // Changed back to what was saved.
    else if (this.firstChangeAt === null) this.firstChangeAt = now;
  }

  /** Whether something is not in the last backup. */
  get unsaved(): boolean {
    return this.current !== this.savedSig;
  }

  /** The time of the oldest change not yet saved, or null. */
  get since(): number | null {
    return this.unsaved ? this.firstChangeAt : null;
  }

  /** Whether a backup should be taken now. */
  due(now: number): boolean {
    if (!this.unsaved || this.firstChangeAt === null) return false;
    return now - this.lastChangeAt >= this.quietMs || now - this.firstChangeAt >= this.maxWaitMs;
  }

  /**
   * Records a backup taken from the data as it was when `sig` was read (just before the copy). Changes made since
   * then stay unsaved, counted from `now`.
   */
  markSaved(sig: string, now: number) {
    this.savedSig = sig;
    if (this.current === sig) this.firstChangeAt = null;
    else this.firstChangeAt = now;
  }
}
