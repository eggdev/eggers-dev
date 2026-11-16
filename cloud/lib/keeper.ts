// The keeper's life, in order: restore, self-test, run the app, back up on change, and on SIGTERM stop the app,
// back up once more and exit. cloud/keeper.ts wires it to the real store, processes and clock; the tests wire it
// to fakes. The rule that matters most: no backup is ever taken unless the restore succeeded (or the owner allowed
// an empty start), because a backup of an empty database would replace the owner's data.
import { mkdirSync } from 'node:fs';
import { filesToKeep, type Layout } from './archive.ts';
import { prepareBackup, sendBackup } from './backup.ts';
import { ChangeTracker, signature } from './changes.ts';
import { Supervisor, type ChildSpec, type Spawn } from './children.ts';
import type { DbStats, Manifest } from './manifest.ts';
import { restore } from './restore.ts';
import type { SelfTest } from './selftest.ts';
import { Watcher } from './sqlite.ts';
import type { Store } from './store.ts';

export type Phase = 'restoring' | 'running' | 'stopping' | 'stopped' | 'failed';

export type KeeperDeps = {
  store: Store;
  layout: Layout;
  /** The keeper's own folder for copies and downloads, outside the data folder. */
  work: string;
  allowEmpty: boolean;
  allowShrink: boolean;
  children: ChildSpec[];
  spawn: Spawn;
  selfTest: () => Promise<SelfTest>;
  log: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  quietMs?: number;
  maxWaitMs?: number;
  /** How often the data's signature is read. */
  pollMs?: number;
  /** How long a child has after SIGTERM before SIGKILL. */
  childGraceMs?: number;
  /** The restore's waits, shortened in tests. */
  restoreWaitMs?: number;
};

export type KeeperStatus = {
  phase: Phase;
  note: string;
  startedAt: number;
  restoredFrom: { key: string; createdAt: number } | 'empty' | null;
  lastBackup: { key: string; at: number; size: number } | null;
  lastBackupError: string | null;
  unsaved: boolean;
  unsavedSince: number | null;
  busy: boolean;
  children: Record<string, { running: boolean; starts: number; lastExit: number | null }>;
  selfTest: SelfTest | null;
};

export class Keeper {
  private phase: Phase = 'restoring';
  private note = '';
  private readonly startedAt: number;
  private restoredFrom: KeeperStatus['restoredFrom'] = null;
  private lastBackup: KeeperStatus['lastBackup'] = null;
  private lastBackupError: string | null = null;
  private last: DbStats | null = null;
  private tracker: ChangeTracker | null = null;
  private selfTestResult: SelfTest | null = null;
  private readonly supervisors: Supervisor[];
  private readonly watcher: Watcher;
  private chain: Promise<unknown> = Promise.resolve();
  private stopRequested = false;
  private wakeLoop: () => void = () => {};
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: KeeperDeps) {
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => Bun.sleep(ms));
    this.startedAt = this.now();
    this.supervisors = d.children.map((spec) => new Supervisor(spec, d.spawn, d.log, this.now, this.sleep));
    this.watcher = new Watcher(d.layout.db);
  }

  private files() {
    return filesToKeep({ ...this.d.layout, skip: [...(this.d.layout.skip ?? []), this.d.work] });
  }

  private sig(): string {
    return signature(this.watcher.dataVersion(), this.files());
  }

  /** Restores, then starts the app. Resolves once the app runs, or once the keeper gives up or is stopped. */
  async start(): Promise<void> {
    mkdirSync(this.d.work, { recursive: true });
    let wait = this.d.restoreWaitMs ?? 30_000;
    for (;;) {
      if (this.stopRequested) return;
      this.phase = 'restoring';
      const r = await restore({
        store: this.d.store, layout: this.d.layout, work: this.d.work, allowEmpty: this.d.allowEmpty, log: this.d.log, sleep: this.sleep,
        indexAttempts: 5, firstWaitMs: this.d.restoreWaitMs ?? 2_000, maxWaitMs: (this.d.restoreWaitMs ?? 2_000) * 30,
      });
      if (r.kind === 'restored') {
        this.restoredFrom = { key: r.manifest.key, createdAt: r.manifest.createdAt };
        this.last = r.manifest.db;
        this.lastBackup = { key: r.manifest.key, at: r.manifest.createdAt, size: r.manifest.size };
        break;
      }
      if (r.kind === 'empty') {
        this.restoredFrom = 'empty';
        break;
      }
      // Refused: the app does not start. The status says why; a store that may come back is asked again later.
      this.phase = 'failed';
      this.note = r.reason;
      this.d.log(`keeper: the app was not started: ${r.reason}`);
      if (!r.retry) return;
      await Promise.race([this.sleep(wait), new Promise<void>((resolve) => { this.wakeLoop = resolve; })]);
      wait = Math.min(wait * 2, 10 * 60_000);
    }
    if (this.stopRequested) return;

    // Codex warns when its home is missing (an empty start, or a backup without a sign-in).
    if (this.d.layout.codexHome) mkdirSync(this.d.layout.codexHome, { recursive: true });
    // The data as restored is the data as saved.
    this.tracker = new ChangeTracker(this.sig(), { quietMs: this.d.quietMs, maxWaitMs: this.d.maxWaitMs });
    this.phase = 'running';
    this.note = '';
    // The self-test runs beside the app, so a wake from sleep is not slowed by it.
    void this.d.selfTest().then((t) => { this.selfTestResult = t; }).catch((e) => this.d.log(`keeper: the self-test failed to run (${(e as Error).message})`));
    for (const s of this.supervisors) s.start();
    void this.watch();
  }

  private async watch() {
    while (this.phase === 'running') {
      await Promise.race([this.sleep(this.d.pollMs ?? 5_000), new Promise<void>((resolve) => { this.wakeLoop = resolve; })]);
      if (this.phase !== 'running') break;
      await this.tick();
    }
  }

  /** One look at the data: records a change, and backs up when one is due. */
  async tick(): Promise<void> {
    if (this.phase !== 'running' || !this.tracker) return;
    this.tracker.observe(this.sig(), this.now());
    if (this.tracker.due(this.now())) await this.backup('changed');
  }

  /**
   * Takes a backup now when anything is unsaved (or always, when forced). Backups never overlap: each waits for
   * the one before it.
   */
  backup(why: 'changed' | 'asked' | 'stopping', force = false): Promise<{ ok: boolean; key?: string; reason?: string }> {
    const job = this.chain.then(async () => {
      if (!this.tracker || (this.phase !== 'running' && this.phase !== 'stopping')) return { ok: false, reason: 'the app is not running, so there is nothing to back up' };
      this.tracker.observe(this.sig(), this.now());
      if (!this.tracker.unsaved && !force) return { ok: true, reason: 'nothing changed since the last backup' };
      const before = this.sig();
      const at = this.now();
      try {
        const r = await prepareBackup({ layout: this.d.layout, work: this.d.work, from: 'keeper', last: this.last, allowShrink: this.d.allowShrink, now: at });
        if (r.kind === 'refused') {
          this.lastBackupError = r.reason;
          this.d.log(`keeper: BACKUP REFUSED (${why}): ${r.reason}`);
          // Not retried until the data changes again.
          this.tracker.markSaved(before, this.now());
          return { ok: false, reason: r.reason };
        }
        if (r.prepared.warning) this.d.log(`keeper: WARNING: ${r.prepared.warning}`);
        await sendBackup(this.d.store, r.prepared);
        const m: Manifest = r.prepared.manifest;
        this.last = m.db;
        this.lastBackup = { key: m.key, at, size: m.size };
        this.lastBackupError = null;
        this.tracker.markSaved(before, this.now());
        this.d.log(`keeper: backed up (${why}) to ${m.key}: ${m.size} bytes, ${m.files} files`);
        return { ok: true, key: m.key };
      } catch (error) {
        this.lastBackupError = (error as Error).message;
        this.d.log(`keeper: the backup failed (${why}): ${(error as Error).message}`);
        return { ok: false, reason: (error as Error).message };
      }
    });
    this.chain = job.catch(() => {});
    return job;
  }

  /** SIGTERM or SIGINT: stop the app, back up anything unsaved, and return the exit code (0). */
  async stop(signal: string): Promise<number> {
    if (this.stopRequested) return 0;
    this.stopRequested = true;
    const wasRunning = this.phase === 'running';
    this.d.log(`keeper: ${signal}: stopping`);
    if (wasRunning) this.phase = 'stopping';
    this.wakeLoop();
    await Promise.all(this.supervisors.map((s) => s.stop(this.d.childGraceMs ?? 20_000)));
    // A backup only when the app ran on restored (or allowed empty) data: never after a failed restore.
    if (wasRunning) {
      const r = await this.backup('stopping');
      if (!r.ok) this.d.log(`keeper: the last backup did not happen: ${r.reason}`);
    }
    this.watcher.close();
    this.phase = 'stopped';
    this.d.log('keeper: stopped');
    return 0;
  }

  status(): KeeperStatus {
    return {
      phase: this.phase,
      note: this.note,
      startedAt: this.startedAt,
      restoredFrom: this.restoredFrom,
      lastBackup: this.lastBackup,
      lastBackupError: this.lastBackupError,
      unsaved: this.tracker?.unsaved ?? false,
      unsavedSince: this.tracker?.since ?? null,
      busy: this.phase === 'running' ? this.watcher.busy() : false,
      children: Object.fromEntries(this.d.children.map((c, i) => [c.name, { ...this.supervisors[i]!.state }])),
      selfTest: this.selfTestResult,
    };
  }
}
