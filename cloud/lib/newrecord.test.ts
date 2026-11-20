// The shrink guard and a new record (lib/reset.ts): the one backup taken after the owner starts a new record is let
// through once, and never again. A fake store and tiny invented databases in temporary folders; nothing reaches the
// network. Run from the repository root: `bun test cloud`.
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Layout } from './archive.ts';
import { prepareBackup, sendBackup } from './backup.ts';
import type { ChildSpec, Proc } from './children.ts';
import { Keeper } from './keeper.ts';
import { backupKey, parseManifest, shrinkCheck, type DbStats } from './manifest.ts';
import type { SelfTest } from './selftest.ts';
import { FakeStore, makeDb } from './testing.ts';

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'keeper-reset-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 19, 9);
const MIN = 60_000;

describe('the shrink guard with a mark of a new record', () => {
  const last: DbStats = { bytes: 1000, roles: 5, facts: 50, jobs: 3 };
  const empty: DbStats = { bytes: 300, roles: 0, facts: 0, jobs: 3 };

  test('a mark greater than the last backup’s lets one smaller backup through, and says so', () => {
    const r = shrinkCheck(last, { ...empty, resetAt: T0 + MIN }, false);
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toContain('allowed once: the owner started a new record at 2026-11-19T09:01:00.000Z');
  });

  test('without a mark, or with one the last backup recorded already, the same backup is refused', () => {
    expect(shrinkCheck(last, empty, false).ok).toBe(false);
    expect(shrinkCheck({ ...last, resetAt: T0 + MIN }, { ...empty, resetAt: T0 + MIN }, false).ok).toBe(false);
    // A second new record is allowed in its turn: its mark is greater, whatever the clock said.
    expect(shrinkCheck({ ...last, resetAt: T0 + MIN }, { ...empty, resetAt: T0 + MIN + 1 }, false).ok).toBe(true);
  });

  test('the seed tool never honours the mark', async () => {
    expect(shrinkCheck(last, { ...empty, resetAt: T0 + MIN }, false, false).ok).toBe(false);
    const root = temp();
    const layout: Layout = { db: join(root, 'data', 'egg.db'), codexHome: null };
    makeDb(layout.db, 0, 0);
    mark(layout, T0);
    const r = await prepareBackup({ layout, work: join(root, 'work'), from: 'seed', last, honourReset: false, allowShrink: false, now: T0 + MIN });
    expect(r.kind).toBe('refused');
    // And the tool asks for that.
    expect(readFileSync(join(import.meta.dir, '..', 'tools', 'seed.ts'), 'utf8')).toMatch(/prepareBackup\(\{[\s\S]*honourReset: false,[\s\S]*\}\)/);
  });

  test('a manifest keeps the mark, an old manifest has none, and a broken one is refused', () => {
    const good = { format: 1, key: backupKey(T0), createdAt: T0, size: 10, sha256: 'a'.repeat(64), db: { bytes: 1, roles: 0, facts: 0, jobs: 0, resetAt: T0 - 5 }, files: 1, from: 'keeper' };
    expect(parseManifest(good)?.db.resetAt).toBe(T0 - 5);
    expect(parseManifest({ ...good, db: { bytes: 1, roles: 0, facts: 0, jobs: 0 } })?.db).toEqual({ bytes: 1, roles: 0, facts: 0, jobs: 0 });
    expect(parseManifest({ ...good, db: { ...good.db, resetAt: -1 } })).toBeNull();
    expect(parseManifest({ ...good, db: { ...good.db, resetAt: 'soon' } })).toBeNull();
  });
});

/** What lib/reset.ts writes: a mark of a new record. */
function mark(layout: Layout, at: number) {
  const db = new Database(layout.db);
  db.run('CREATE TABLE IF NOT EXISTS record_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL)');
  db.query('INSERT INTO record_resets (at) VALUES (?)').run(at);
  db.close();
}

describe('the keeper after a new record', () => {
  const children: ChildSpec[] = [
    { name: 'server', cmd: ['true'], cwd: '/', env: {} },
    { name: 'worker', cmd: ['true'], cwd: '/', env: {} },
  ];
  const spawn = (): Proc => {
    let exit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => { exit = resolve; });
    return { exited, kill: () => exit(0) };
  };
  const noSelfTest = async (): Promise<SelfTest> => ({ at: 0, programs: {}, codexSignedIn: { ok: false, detail: 'test' }, codexSandbox: { state: 'unknown', detail: 'test' } });

  /** A store holding one backup of an invented record, taken at T0. */
  async function storeWithRecord() {
    const store = new FakeStore();
    store.now = () => T0;
    const root = temp();
    const layout: Layout = { db: join(root, 'data', 'egg.db'), codexHome: null };
    makeDb(layout.db, 2, 5);
    const r = await prepareBackup({ layout, work: join(root, 'work'), from: 'seed', last: null, allowShrink: false, now: T0 });
    if (r.kind !== 'ready') throw new Error(r.reason);
    await sendBackup(store, r.prepared);
    return { store, first: r.prepared.manifest };
  }

  /** A keeper on an empty data folder that restores from `store`, on a clock the test moves. */
  async function keeperOn(store: FakeStore, clock: { t: number }) {
    const root = temp();
    const layout: Layout = { db: join(root, 'data', 'egg.db'), codexHome: null };
    const keeper = new Keeper({ store, layout, work: join(root, 'work'), allowEmpty: false, allowShrink: false, children, spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000, now: () => clock.t });
    await keeper.start();
    expect(keeper.status().phase).toBe('running');
    return { keeper, layout };
  }

  /** What the app does: lib/reset.ts empties the record and writes the mark; or a write of its own. */
  const write = (layout: Layout, sql: string[]) => {
    const db = new Database(layout.db);
    for (const s of sql) db.run(s);
    db.close();
  };
  const startNewRecord = (layout: Layout, at: number) => write(layout, ['DELETE FROM roles', 'DELETE FROM facts',
    'CREATE TABLE IF NOT EXISTS record_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL)', `INSERT INTO record_resets (at) VALUES (${at})`]);

  test('the backup after a new record is accepted once; a later shrink is refused as before', async () => {
    const { store } = await storeWithRecord();
    const clock = { t: T0 + 10 * MIN };
    const { keeper, layout } = await keeperOn(store, clock);

    // Back up now, before the reset: nothing changed since the restored backup.
    expect(await keeper.backup('asked')).toEqual({ ok: true, reason: 'nothing changed since the last backup' });
    startNewRecord(layout, T0 + 11 * MIN);
    clock.t = T0 + 12 * MIN;
    const after = await keeper.backup('asked');
    expect(after.ok).toBe(true);
    expect(store.pointer).toMatchObject({ key: after.key, db: { roles: 0, facts: 0, resetAt: T0 + 11 * MIN } });

    // More work, then an accidental shrink: the mark is spent.
    write(layout, ["INSERT INTO roles (title) VALUES ('Invented new role')", "INSERT INTO facts (text) VALUES ('Invented new fact')"]);
    clock.t = T0 + 20 * MIN;
    expect((await keeper.backup('asked')).ok).toBe(true);
    write(layout, ['DELETE FROM facts']);
    clock.t = T0 + 30 * MIN;
    const shrunk = await keeper.backup('asked');
    expect(shrunk.ok).toBe(false);
    expect(shrunk.reason).toContain('it has no facts; the last backup had 1');
    expect(store.pointer!.db.facts).toBe(1);
    // Asked again with nothing changed: the refusal is said again, never "nothing changed".
    const again = await keeper.backup('asked');
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('nothing changed since the last backup was refused');
    await keeper.stop('SIGTERM');
  });

  test('without the mark, a backup with no roles or facts is refused', async () => {
    const { store, first } = await storeWithRecord();
    const clock = { t: T0 + 10 * MIN };
    const { keeper, layout } = await keeperOn(store, clock);
    write(layout, ['DELETE FROM roles', 'DELETE FROM facts']);
    clock.t = T0 + 11 * MIN;
    const r = await keeper.backup('asked');
    expect(r.ok).toBe(false);
    expect(store.pointer!.key).toBe(first.key);
    await keeper.stop('SIGTERM');
  });

  test('after a restart the post-reset backup is restored, not skipped, and its mark allows no later shrink', async () => {
    const { store } = await storeWithRecord();
    const clock = { t: T0 + 10 * MIN };
    const one = await keeperOn(store, clock);
    startNewRecord(one.layout, T0 + 11 * MIN);
    clock.t = T0 + 12 * MIN;
    const after = await one.keeper.backup('asked');
    expect(after.ok).toBe(true);
    // More work, backed up as the keeper stops.
    write(one.layout, ["INSERT INTO roles (title) VALUES ('Invented new role')", "INSERT INTO facts (text) VALUES ('Invented new fact')"]);
    clock.t = T0 + 20 * MIN;
    await one.keeper.stop('SIGTERM');
    const latest = store.pointer!;
    expect(latest.db).toMatchObject({ roles: 1, facts: 1, resetAt: T0 + 11 * MIN });

    clock.t = T0 + 60 * MIN;
    const two = await keeperOn(store, clock);
    expect(two.keeper.status().restoredFrom).toEqual({ key: latest.key, createdAt: latest.createdAt });
    write(two.layout, ['DELETE FROM roles', 'DELETE FROM facts']);
    clock.t = T0 + 61 * MIN;
    expect((await two.keeper.backup('asked')).ok).toBe(false);
    await two.keeper.stop('SIGTERM');

    // The backup taken right after the reset, with no roles and no facts, restores too when it is the newest one.
    store.pointer = store.manifests.get(after.key!)!;
    for (const k of [...store.manifests.keys()]) if (store.manifests.get(k)!.createdAt > store.pointer.createdAt) { store.manifests.delete(k); store.objects.delete(k); }
    const three = await keeperOn(store, clock);
    expect(three.keeper.status().restoredFrom).toEqual({ key: after.key, createdAt: T0 + 12 * MIN });
    await three.keeper.stop('SIGTERM');
  });

  test('a reset lost before its backup: the restart restores the old record, and the lost mark allows nothing', async () => {
    const { store, first } = await storeWithRecord();
    const clock = { t: T0 + 10 * MIN };
    const one = await keeperOn(store, clock);
    startNewRecord(one.layout, T0 + 11 * MIN);
    // The container dies with no last backup (a crash): the keeper is stopped as one that never ran, so nothing is uploaded.
    (one.keeper as unknown as { phase: string }).phase = 'failed';
    await one.keeper.stop('SIGKILL');
    expect(store.pointer!.key).toBe(first.key);
    const two = await keeperOn(store, clock);
    expect(two.keeper.status().restoredFrom).toEqual({ key: first.key, createdAt: T0 });
    write(two.layout, ['DELETE FROM roles', 'DELETE FROM facts']);
    clock.t = T0 + 20 * MIN;
    expect((await two.keeper.backup('asked')).ok).toBe(false);
    await two.keeper.stop('SIGTERM');
  });
  test('a backup that copied the database just before the reset committed, with a later time, does not stop the next one', async () => {
    const { store, first } = await storeWithRecord();
    const folder = () => { const root = temp(); const layout: Layout = { db: join(root, 'data', 'egg.db'), codexHome: null }; makeDb(layout.db, 2, 5); return { layout, work: join(root, 'work') }; };
    const ready = async (f: { layout: Layout; work: string }, last: DbStats, now: number) => {
      const r = await prepareBackup({ layout: f.layout, work: f.work, from: 'keeper', last, allowShrink: false, now });
      if (r.kind === 'ready') await sendBackup(store, r.prepared);
      return r;
    };
    // The reset takes its mark at 11 minutes; a backup that copied the old record before the reset committed is
    // taken at 12 and accepted, with no mark.
    const old = folder();
    const racing = await ready(old, first.db, T0 + 12 * MIN);
    if (racing.kind !== 'ready') throw new Error(racing.reason);
    expect(racing.prepared.manifest.db.resetAt).toBeUndefined();
    // The next backup holds the reset, and is still let through.
    const reset = folder();
    write(reset.layout, ['DELETE FROM roles', 'DELETE FROM facts']);
    mark(reset.layout, T0 + 11 * MIN);
    const after = await ready(reset, racing.prepared.manifest.db, T0 + 13 * MIN);
    if (after.kind !== 'ready') throw new Error(after.reason);
    expect(store.pointer!.db).toMatchObject({ roles: 0, facts: 0, resetAt: T0 + 11 * MIN });
    // A later accidental shrink is refused as before.
    write(reset.layout, ["INSERT INTO roles (title) VALUES ('Invented new role')", "INSERT INTO facts (text) VALUES ('Invented new fact')"]);
    const more = await ready(reset, after.prepared.manifest.db, T0 + 14 * MIN);
    if (more.kind !== 'ready') throw new Error(more.reason);
    write(reset.layout, ['DELETE FROM facts']);
    expect((await ready(reset, more.prepared.manifest.db, T0 + 15 * MIN)).kind).toBe('refused');
  });

  test('a second new record is let through even when its clock is behind the first', async () => {
    const { store } = await storeWithRecord();
    const clock = { t: T0 + 10 * MIN };
    const { keeper, layout } = await keeperOn(store, clock);
    startNewRecord(layout, T0 + 11 * MIN);
    clock.t = T0 + 12 * MIN;
    expect((await keeper.backup('asked')).ok).toBe(true);
    write(layout, ["INSERT INTO roles (title) VALUES ('Invented new role')", "INSERT INTO facts (text) VALUES ('Invented new fact')"]);
    clock.t = T0 + 13 * MIN;
    expect((await keeper.backup('asked')).ok).toBe(true);
    // The clock went back an hour; lib/reset.ts still writes a mark one greater than the last.
    startNewRecord(layout, T0 + 11 * MIN + 1);
    clock.t = T0 + 14 * MIN;
    expect((await keeper.backup('asked')).ok).toBe(true);
    expect(store.pointer!.db).toMatchObject({ roles: 0, facts: 0, resetAt: T0 + 11 * MIN + 1 });
    await keeper.stop('SIGTERM');
  });
});
