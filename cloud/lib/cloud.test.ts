// Tests for the container's keeper with a fake store and tiny invented databases in temporary folders.
// Nothing here reads .data/ or reaches the network. Run from the repository root: `bun test cloud`.
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArchive, filesToKeep, listArchive, unpackArchive, type Layout } from './archive.ts';
import { prepareBackup, sendBackup } from './backup.ts';
import { ChangeTracker, signature } from './changes.ts';
import type { ChildSpec, Proc } from './children.ts';
import { Keeper } from './keeper.ts';
import { backupKey, isBackupKey, parseManifest, shrinkCheck, toPrune, type Manifest } from './manifest.ts';
import { restore } from './restore.ts';
import { signInKind, type SelfTest } from './selftest.ts';
import { checkDatabase, copyDatabase, statsOf, Watcher } from './sqlite.ts';
import { FakeStore, makeDb } from './testing.ts';

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'keeper-test-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A data folder with a database and a few files, as the app leaves it. */
function dataFolder(roles = 2, facts = 5) {
  const root = temp();
  const data = join(root, 'data');
  const layout: Layout = { db: join(data, 'egg.db'), codexHome: join(data, 'codex') };
  makeDb(layout.db, roles, facts);
  mkdirSync(join(data, 'inbox'), { recursive: true });
  writeFileSync(join(data, 'inbox', 'notes.txt'), 'invented notes');
  mkdirSync(join(data, 'resumes'), { recursive: true });
  writeFileSync(join(data, 'resumes', 'job-1.pdf'), '%PDF-1.7 invented');
  writeFileSync(join(data, 'profile.md'), '# Invented profile');
  mkdirSync(join(data, 'codex'), { recursive: true });
  writeFileSync(join(data, 'codex', 'auth.json'), '{"invented":"sign-in"}');
  writeFileSync(join(data, 'codex', 'history.jsonl'), 'not kept');
  return { root, data, layout, work: join(root, 'work') };
}

/** Puts one backup of a data folder in the store, as the keeper would, and returns its manifest. */
async function seedStore(store: FakeStore, at: number, roles = 2, facts = 5): Promise<Manifest> {
  const f = dataFolder(roles, facts);
  const r = await prepareBackup({ layout: f.layout, work: f.work, from: 'seed', last: null, allowShrink: false, now: at });
  if (r.kind !== 'ready') throw new Error(r.reason);
  await sendBackup(store, r.prepared);
  return r.prepared.manifest;
}

const emptyTarget = () => {
  const root = temp();
  return { layout: { db: join(root, 'data', 'egg.db'), codexHome: join(root, 'data', 'codex') } as Layout, work: join(root, 'work') };
};
const quiet = { log: () => {}, sleep: async () => {} };

// ---------------------------------------------------------------------------------------------------------------

describe('manifest, retention and the shrink guard', () => {
  test('backup keys sort by time and are the only keys accepted', () => {
    const a = backupKey(Date.UTC(2026, 10, 16, 13, 45, 12, 345));
    expect(a).toBe('backups/2026-11-16T13-45-12-345Z.tar.gz');
    expect(isBackupKey(a)).toBe(true);
    for (const bad of ['backups/../latest.json', 'latest.json', 'backups/x.tar.gz', `/${a}`, `${a}.json`, 'backups/2026-11-16T13-45-12-345Z.tar.gz/x']) expect(isBackupKey(bad)).toBe(false);
    expect(backupKey(1) < backupKey(2)).toBe(true);
  });

  test('parseManifest refuses a manifest with a missing or wrong field', () => {
    const good = { format: 1, key: backupKey(0), createdAt: 0, size: 10, sha256: 'a'.repeat(64), db: { bytes: 1, roles: 0, facts: 0, jobs: 0 }, files: 1, from: 'keeper' };
    expect(parseManifest(good)).toEqual(good as Manifest);
    for (const bad of [{ ...good, key: 'latest.json' }, { ...good, sha256: 'xyz' }, { ...good, db: { bytes: 1 } }, { ...good, from: 'other' }, { ...good, size: -1 }, null, 'text']) {
      expect(parseManifest(bad)).toBeNull();
    }
  });

  test('retention keeps the newest 30, one per day for 30 days, and the pointer', () => {
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 10, 16, 12);
    // Ten backups a day for 40 days, one every hour from 01:00.
    const backups = [];
    for (let d = 0; d < 40; d++) for (let h = 1; h <= 10; h++) {
      const at = now - d * DAY - (12 - h) * 3_600_000;
      backups.push({ key: backupKey(at), createdAt: at });
    }
    const oldest = backups.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    const pruned = new Set(toPrune(backups, now, oldest.key));
    const kept = backups.filter((b) => !pruned.has(b.key));
    const newest30 = [...backups].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    for (const b of newest30) expect(pruned.has(b.key)).toBe(false);
    expect(pruned.has(oldest.key)).toBe(false);
    // Days 0 to 29 each keep their newest backup; days 31 and older keep only what the rules above keep.
    for (let d = 0; d < 30; d++) {
      const day = new Date(now - d * DAY).toISOString().slice(0, 10);
      const ofDay = backups.filter((b) => new Date(b.createdAt).toISOString().slice(0, 10) === day).sort((a, b) => b.createdAt - a.createdAt);
      expect(pruned.has(ofDay[0]!.key)).toBe(false);
    }
    expect(kept.length).toBe(30 + 27 + 1); // 30 newest (3 days), the newest of each of the other 27 days, the pointer
  });

  test('the shrink guard refuses a much smaller database unless allowed', () => {
    const last = { bytes: 1000, roles: 5, facts: 50, jobs: 3 };
    expect(shrinkCheck(null, { bytes: 1, roles: 0, facts: 0, jobs: 0 }, false).ok).toBe(true);
    expect(shrinkCheck(last, { bytes: 900, roles: 5, facts: 49, jobs: 3 }, false).ok).toBe(true);
    expect(shrinkCheck(last, { bytes: 400, roles: 5, facts: 50, jobs: 3 }, false).ok).toBe(false);
    expect(shrinkCheck(last, { bytes: 1000, roles: 0, facts: 50, jobs: 3 }, false).ok).toBe(false);
    expect(shrinkCheck(last, { bytes: 1000, roles: 5, facts: 0, jobs: 3 }, false).ok).toBe(false);
    const allowed = shrinkCheck(last, { bytes: 10, roles: 0, facts: 0, jobs: 0 }, true);
    expect(allowed.ok).toBe(true);
    expect('warning' in allowed && allowed.warning).toContain('EGG_ALLOW_SHRINK');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the database copy', () => {
  test('VACUUM INTO makes a consistent, checked copy while another connection writes in WAL mode', () => {
    const f = dataFolder(1, 1);
    const writer = new Database(f.layout.db);
    writer.run('PRAGMA busy_timeout = 5000');
    writer.run('PRAGMA journal_mode = WAL');
    writer.run('BEGIN');
    writer.query('INSERT INTO facts (text) VALUES (?)').run('not committed yet');
    // An open write transaction: the copy must not wait for it, and must not include it.
    const out = join(f.root, 'copy.db');
    copyDatabase(f.layout.db, out);
    writer.run('COMMIT');
    writer.query('INSERT INTO facts (text) VALUES (?)').run('committed, still in the WAL');
    const out2 = join(f.root, 'copy2.db');
    copyDatabase(f.layout.db, out2);
    writer.close();
    expect(checkDatabase(out)).toEqual({ ok: true });
    expect(statsOf(out).facts).toBe(1);
    expect(statsOf(out2).facts).toBe(3);
    expect(existsSync(`${out2}-wal`)).toBe(false);
  });

  test('a damaged file fails the integrity check', () => {
    const f = dataFolder();
    const out = join(f.root, 'copy.db');
    copyDatabase(f.layout.db, out);
    const bytes = readFileSync(out);
    bytes.fill(0x41, 2048, 6144); // Overwrite part of the second page onwards.
    writeFileSync(out, bytes);
    expect(checkDatabase(out).ok).toBe(false);
    writeFileSync(out, '');
    expect(checkDatabase(out).ok).toBe(false);
  });

  test('the busy check sees queued or running work', () => {
    const f = dataFolder();
    const w = new Watcher(f.layout.db);
    expect(w.busy()).toBe(false);
    const db = new Database(f.layout.db);
    db.run("INSERT INTO sources (status) VALUES ('queued')");
    expect(w.busy()).toBe(true);
    db.run("UPDATE sources SET status = 'done'");
    // A resume queued for a job that is not read yet is not work the worker will take.
    db.run("UPDATE jobs SET status = 'failed', resume_status = 'queued'");
    expect(w.busy()).toBe(false);
    db.run("UPDATE jobs SET status = 'done'");
    expect(w.busy()).toBe(true);
    db.close();
    w.close();
  });

  test('the busy check sees projects being suggested, a told story and a spoken story being written, and a database without their columns is not busy', () => {
    const f = dataFolder();
    const w = new Watcher(f.layout.db);
    const db = new Database(f.layout.db);
    db.run("UPDATE jobs SET status = 'failed'");
    expect(w.busy()).toBe(false);
    db.run("ALTER TABLE roles ADD COLUMN propose_status TEXT NOT NULL DEFAULT ''");
    db.run("CREATE TABLE projects (id INTEGER PRIMARY KEY, derive_status TEXT NOT NULL DEFAULT '')");
    db.run("INSERT INTO projects (derive_status) VALUES ('')");
    expect(w.busy()).toBe(false);
    db.run("UPDATE roles SET propose_status = 'running' WHERE id = 1");
    expect(w.busy()).toBe(true);
    db.run("UPDATE roles SET propose_status = 'done'");
    db.run("UPDATE projects SET derive_status = 'queued'");
    expect(w.busy()).toBe(true);
    db.run("UPDATE projects SET derive_status = 'done'");
    expect(w.busy()).toBe(false);
    // A spoken story being written (lib/spoken.ts) keeps it awake too; a database without its column is not busy.
    db.run("ALTER TABLE projects ADD COLUMN spoken_status TEXT NOT NULL DEFAULT ''");
    expect(w.busy()).toBe(false);
    db.run("UPDATE projects SET spoken_status = 'running'");
    expect(w.busy()).toBe(true);
    db.run("UPDATE projects SET spoken_status = 'done'");
    expect(w.busy()).toBe(false);
    db.close();
    w.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the archive', () => {
  test('keeps the data files and the Codex sign-in; leaves out repos, SQLite side files, earlier copies and links', () => {
    const f = dataFolder();
    mkdirSync(join(f.data, 'repos', 'some-repo'), { recursive: true });
    writeFileSync(join(f.data, 'repos', 'some-repo', 'README.md'), 'cloned');
    writeFileSync(join(f.data, 'egg.db.before-merge'), 'old copy');
    writeFileSync(join(f.data, 'inbox', 'other.db-wal'), 'side file');
    symlinkSync('/etc/hosts', join(f.data, 'inbox', 'link'));
    const rels = filesToKeep(f.layout).map((e) => e.rel);
    expect(rels).toEqual(['codex/auth.json', 'inbox/notes.txt', 'profile.md', 'resumes/job-1.pdf']);
  });

  test('a backup round trip restores the same files', async () => {
    const f = dataFolder();
    const r = await prepareBackup({ layout: f.layout, work: f.work, from: 'keeper', last: null, allowShrink: false, now: Date.now() });
    if (r.kind !== 'ready') throw new Error(r.reason);
    const names = listArchive(r.prepared.file).map((n) => n.replace(/^\.\//, '')).filter((n) => n && !n.endsWith('/')).sort();
    expect(names).toEqual(['codex/auth.json', 'egg.db', 'inbox/notes.txt', 'profile.md', 'resumes/job-1.pdf']);
    expect(r.prepared.manifest.files).toBe(5);
    expect(r.prepared.manifest.db.roles).toBe(2);
  });

  test('an archive with an absolute or climbing path is refused before anything is unpacked', () => {
    const root = temp();
    writeFileSync(join(root, 'evil.txt'), 'x');
    const abs = join(root, 'abs.tar.gz');
    Bun.spawnSync(['tar', '-czPf', abs, join(root, 'evil.txt')]);
    expect(() => listArchive(abs)).toThrow('unsafe path');
    const into = join(root, 'out');
    expect(() => unpackArchive(abs, into)).toThrow('unsafe path');
    expect(existsSync(into)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('restore', () => {
  test('no backup and EGG_ALLOW_EMPTY: starts empty', async () => {
    const t = emptyTarget();
    const r = await restore({ store: new FakeStore(), ...t, allowEmpty: true, ...quiet });
    expect(r.kind).toBe('empty');
    expect(existsSync(t.layout.db)).toBe(false);
  });

  test('no backup without the flag: refused, and not retried', async () => {
    const t = emptyTarget();
    const r = await restore({ store: new FakeStore(), ...t, allowEmpty: false, ...quiet });
    expect(r).toMatchObject({ kind: 'refused', retry: false });
    expect(existsSync(t.layout.db)).toBe(false);
  });

  test('a store that cannot be reached is never read as "no backup", even with EGG_ALLOW_EMPTY', async () => {
    const store = new FakeStore();
    store.fail.index = 99;
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: true, indexAttempts: 3, ...quiet });
    expect(r).toMatchObject({ kind: 'refused', retry: true });
    expect(existsSync(t.layout.db)).toBe(false);
  });

  test('a store that answers after failures: restored', async () => {
    const store = new FakeStore();
    const m = await seedStore(store, Date.now());
    store.fail.index = 2;
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: false, indexAttempts: 5, ...quiet });
    expect(r).toMatchObject({ kind: 'restored', manifest: { key: m.key } });
    expect(statsOf(t.layout.db).facts).toBe(5);
    expect(readFileSync(join(t.layout.codexHome!, 'auth.json'), 'utf8')).toContain('invented');
    expect(readFileSync(join(t.layout.db, '..', 'inbox', 'notes.txt'), 'utf8')).toBe('invented notes');
  });

  test('a corrupt newest backup: the previous one is restored', async () => {
    const store = new FakeStore();
    const older = await seedStore(store, Date.now() - 60_000, 2, 4);
    const newer = await seedStore(store, Date.now(), 2, 6);
    expect(store.pointer!.key).toBe(newer.key);
    const bytes = store.objects.get(newer.key)!;
    bytes[100] = bytes[100]! ^ 0xff; // One changed byte: the checksum no longer matches.
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: false, ...quiet });
    expect(r).toMatchObject({ kind: 'restored', manifest: { key: older.key }, skipped: [newer.key] });
    expect(statsOf(t.layout.db).facts).toBe(4);
  });

  test('a backup whose database fails the integrity check is skipped even when its checksum matches', async () => {
    const store = new FakeStore();
    const older = await seedStore(store, Date.now() - 60_000);
    // A newer "backup" whose archive holds a damaged database, with a manifest that matches the archive.
    const f = dataFolder();
    const copy = join(f.root, 'bad.db');
    copyDatabase(f.layout.db, copy);
    const bytes = readFileSync(copy);
    bytes.fill(0x41, 2048, 6144);
    writeFileSync(copy, bytes);
    const out = join(f.root, 'bad.tar.gz');
    const built = await buildArchive({ dbCopy: copy, files: [], out, work: f.work });
    const bad: Manifest = { ...older, key: backupKey(Date.now()), createdAt: Date.now(), size: built.size, sha256: built.sha256, files: built.files };
    await store.upload(out, bad);
    await store.commit(bad.key);
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: false, ...quiet });
    expect(r).toMatchObject({ kind: 'restored', manifest: { key: older.key }, skipped: [bad.key] });
  });

  test('every backup corrupt: refused, and the data folder holds no database', async () => {
    const store = new FakeStore();
    for (const at of [Date.now() - 2000, Date.now() - 1000]) {
      const m = await seedStore(store, at);
      store.objects.set(m.key, new Uint8Array([1, 2, 3]));
    }
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: true, ...quiet });
    expect(r).toMatchObject({ kind: 'refused', retry: true });
    expect(existsSync(t.layout.db)).toBe(false);
  });

  test('a download that fails twice and then works is retried, not skipped', async () => {
    const store = new FakeStore();
    const m = await seedStore(store, Date.now());
    store.fail.download = 2;
    const t = emptyTarget();
    const r = await restore({ store, ...t, allowEmpty: false, downloadAttempts: 3, ...quiet });
    expect(r).toMatchObject({ kind: 'restored', manifest: { key: m.key }, skipped: [] });
  });

  test('a data folder that already holds a database is never written over', async () => {
    const store = new FakeStore();
    await seedStore(store, Date.now());
    const f = dataFolder(1, 1);
    const r = await restore({ store, layout: f.layout, work: f.work, allowEmpty: false, ...quiet });
    expect(r).toMatchObject({ kind: 'refused', retry: false });
    expect(statsOf(f.layout.db).facts).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('backup', () => {
  test('the pointer is written last, and not at all when the upload fails', async () => {
    const store = new FakeStore();
    const first = await seedStore(store, Date.now() - 1000);
    expect(store.events).toEqual([`upload ${first.key}`, `commit ${first.key}`]);

    store.fail.upload = 1;
    const f = dataFolder();
    const r = await prepareBackup({ layout: f.layout, work: f.work, from: 'keeper', last: first.db, allowShrink: false, now: Date.now() });
    if (r.kind !== 'ready') throw new Error(r.reason);
    await expect(sendBackup(store, r.prepared)).rejects.toThrow('500');
    expect(store.events.at(-1)).toBe(`upload ${r.prepared.manifest.key}`);
    expect(store.pointer!.key).toBe(first.key);
    expect(existsSync(r.prepared.file)).toBe(false);
  });

  test('a much smaller database is not uploaded unless EGG_ALLOW_SHRINK', async () => {
    const big = dataFolder(5, 400);
    const last = statsOf(big.layout.db);
    const small = dataFolder(0, 0);
    const refused = await prepareBackup({ layout: small.layout, work: small.work, from: 'keeper', last, allowShrink: false, now: Date.now() });
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.reason).toContain('EGG_ALLOW_SHRINK');
    const allowed = await prepareBackup({ layout: small.layout, work: small.work, from: 'keeper', last, allowShrink: true, now: Date.now() });
    expect(allowed.kind).toBe('ready');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('change detection', () => {
  test('a backup is due after the quiet period, or after the longest wait during steady changes', () => {
    const t = new ChangeTracker('s0', { quietMs: 45_000, maxWaitMs: 300_000 });
    expect(t.unsaved).toBe(false);
    expect(t.due(0)).toBe(false);
    t.observe('s1', 1_000);
    expect(t.unsaved).toBe(true);
    expect(t.due(30_000)).toBe(false);
    expect(t.due(46_000)).toBe(true);

    // A change every 20 s never leaves 45 s of quiet; the backup is due 5 minutes after the first change.
    const busy = new ChangeTracker('s0', { quietMs: 45_000, maxWaitMs: 300_000 });
    let due = -1;
    for (let now = 0, i = 1; now <= 400_000; now += 5_000) {
      if (now % 20_000 === 0) busy.observe(`s${i++}`, now);
      if (busy.due(now)) { due = now; break; }
    }
    expect(due).toBe(300_000);
  });

  test('a change back to the saved state is not unsaved; changes after a snapshot stay unsaved', () => {
    const t = new ChangeTracker('s0', { quietMs: 10, maxWaitMs: 100 });
    t.observe('s1', 1);
    t.observe('s0', 2);
    expect(t.unsaved).toBe(false);
    expect(t.due(1000)).toBe(false);
    t.observe('s2', 3);
    // The backup copied s2, but s3 arrived while it ran.
    t.observe('s3', 5);
    t.markSaved('s2', 6);
    expect(t.unsaved).toBe(true);
    expect(t.since).toBe(6);
    t.markSaved('s3', 7);
    expect(t.unsaved).toBe(false);
  });

  test('a changed Codex sign-in file changes the signature: by size, by time, or by content alone', () => {
    const f = dataFolder();
    const auth = join(f.data, 'codex', 'auth.json');
    const sig = () => signature(1, filesToKeep(f.layout));
    // A whole-second time, so it can be set again exactly.
    const at = new Date(Date.UTC(2026, 10, 16, 12));
    utimesSync(auth, at, at);
    const s0 = sig();
    expect(sig()).toBe(s0);

    // Codex renews its tokens: another content. Here with the same size and the same time, the hardest case.
    const size = statSync(auth).size;
    writeFileSync(auth, '{"invented":"SIGN-IN"}');
    utimesSync(auth, at, at);
    expect(statSync(auth).size).toBe(size);
    expect(statSync(auth).mtimeMs).toBe(at.getTime());
    const s1 = sig();
    expect(s1).not.toBe(s0);

    // The same content written again at another time, and a longer content.
    utimesSync(auth, at, new Date(at.getTime() + 60_000));
    const s2 = sig();
    expect(s2).not.toBe(s1);
    writeFileSync(auth, '{"invented":"a longer sign-in"}');
    expect(sig()).not.toBe(s2);

    // config.toml counts in the same way, from the moment it exists.
    const s3 = sig();
    const config = join(f.data, 'codex', 'config.toml');
    writeFileSync(config, 'model = "invented"\n');
    utimesSync(config, at, at);
    const s4 = sig();
    expect(s4).not.toBe(s3);
    writeFileSync(config, 'model = "INVENTED"\n');
    utimesSync(config, at, at);
    expect(sig()).not.toBe(s4);

    // What a backup does not hold does not count: Codex's logs, its lock files, its session records.
    const s5 = sig();
    writeFileSync(join(f.data, 'codex', 'history.jsonl'), 'more history');
    writeFileSync(join(f.data, 'codex', 'auth.json.lock'), '');
    mkdirSync(join(f.data, 'codex', 'log'), { recursive: true });
    writeFileSync(join(f.data, 'codex', 'log', 'codex.log'), 'a log line');
    expect(sig()).toBe(s5);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the keeper', () => {
  /** Fake app processes: each exits when it gets a signal. `order` records kills and backups in order. */
  function fakeApp(order: string[]) {
    const procs: { name: string; signals: string[] }[] = [];
    const spawn = (spec: ChildSpec): Proc => {
      let exit: (code: number) => void = () => {};
      const exited = new Promise<number>((resolve) => { exit = resolve; });
      const p = { name: spec.name, signals: [] as string[] };
      procs.push(p);
      return {
        exited,
        kill(signal) {
          p.signals.push(String(signal));
          order.push(`kill ${spec.name}`);
          exit(0);
        },
      };
    };
    return { spawn, procs };
  }
  const children: ChildSpec[] = [
    { name: 'server', cmd: ['true'], cwd: '/', env: {} },
    { name: 'worker', cmd: ['true'], cwd: '/', env: {} },
  ];
  const noSelfTest = async (): Promise<SelfTest> => ({ at: 0, programs: {}, codexSignedIn: { ok: false, detail: 'test' }, codexSandbox: { state: 'unknown', detail: 'test' } });

  test('SIGTERM: the app stops first, then the unsaved change is backed up, then the keeper exits 0', async () => {
    const store = new FakeStore();
    const seeded = await seedStore(store, Date.now() - 10_000);
    const order: string[] = [];
    const origUpload = store.upload.bind(store);
    store.upload = async (file, m) => { order.push('upload'); return origUpload(file, m); };
    const t = emptyTarget();
    const app = fakeApp(order);
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn: app.spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000 });
    await keeper.start();
    expect(keeper.status()).toMatchObject({ phase: 'running', restoredFrom: { key: seeded.key }, unsaved: false });
    expect(app.procs.map((p) => p.name)).toEqual(['server', 'worker']);

    // The app writes something.
    const db = new Database(t.layout.db);
    db.query('INSERT INTO facts (text) VALUES (?)').run('new invented fact');
    db.close();
    writeFileSync(join(t.layout.db, '..', 'inbox', 'new.txt'), 'new');
    await keeper.tick();
    expect(keeper.status().unsaved).toBe(true);

    const code = await keeper.stop('SIGTERM');
    expect(code).toBe(0);
    expect(order).toEqual(['kill server', 'kill worker', 'upload']);
    expect(app.procs.every((p) => p.signals[0] === 'SIGTERM')).toBe(true);
    expect(store.pointer!.key).not.toBe(seeded.key);
    expect(store.pointer!.db.facts).toBe(6);
    expect(keeper.status().phase).toBe('stopped');
  });

  test('SIGTERM with nothing changed uploads nothing', async () => {
    const store = new FakeStore();
    await seedStore(store, Date.now() - 10_000);
    store.events = [];
    const t = emptyTarget();
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn: fakeApp([]).spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000 });
    await keeper.start();
    await keeper.stop('SIGTERM');
    expect(store.events).toEqual([]);
  });

  test('a refused restore never starts the app, and SIGTERM then backs up nothing', async () => {
    const store = new FakeStore();
    const t = emptyTarget();
    const app = fakeApp([]);
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn: app.spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000 });
    await keeper.start();
    expect(keeper.status()).toMatchObject({ phase: 'failed' });
    expect(keeper.status().note).toContain('no backup yet');
    expect(app.procs).toEqual([]);
    expect(await keeper.backup('asked')).toMatchObject({ ok: false });
    await keeper.stop('SIGTERM');
    expect(store.events).toEqual([]);
  });

  test('a change is backed up by itself once the quiet period has passed', async () => {
    const store = new FakeStore();
    await seedStore(store, Date.now() - 10_000);
    let clock = 1_000_000;
    const t = emptyTarget();
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn: fakeApp([]).spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000, now: () => clock, quietMs: 45_000 });
    await keeper.start();
    store.events = [];
    writeFileSync(join(t.layout.db, '..', 'profile.md'), '# Changed');
    await keeper.tick();
    clock += 30_000;
    await keeper.tick();
    expect(store.events).toEqual([]);
    clock += 20_000;
    await keeper.tick();
    expect(keeper.status().lastBackupError).toBeNull();
    expect(store.events.length).toBe(2);
    expect(keeper.status().unsaved).toBe(false);
    await keeper.stop('SIGTERM');
  });
});

describe('the Codex sign-in files and the keeper', () => {
  const children: ChildSpec[] = [{ name: 'server', cmd: ['true'], cwd: '/', env: {} }];
  const spawn = (): Proc => {
    let exit: (code: number) => void = () => {};
    return { exited: new Promise<number>((resolve) => { exit = resolve; }), kill: () => exit(0) };
  };
  const noSelfTest = async (): Promise<SelfTest> => ({ at: 0, programs: {}, codexSignedIn: { ok: false, detail: 'test' }, codexSandbox: { state: 'unknown', detail: 'test' } });

  test('a sign-in that Codex renewed by itself is unsaved data, is backed up, and is what the next start restores', async () => {
    const store = new FakeStore();
    await seedStore(store, Date.now() - 10_000);
    let clock = 1_000_000;
    const t = emptyTarget();
    const logs: string[] = [];
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn, selfTest: noSelfTest, log: (l) => logs.push(l), pollMs: 1_000_000, now: () => clock, quietMs: 45_000 });
    await keeper.start();
    store.events = [];
    await keeper.tick();
    expect(keeper.status().unsaved).toBe(false);

    // Codex writes its renewed tokens. The database and the app's files do not change.
    writeFileSync(join(t.layout.codexHome!, 'auth.json'), '{"invented":"RENEWED"}');
    await keeper.tick();
    expect(keeper.status().unsaved).toBe(true);
    expect(store.events).toEqual([]);
    clock += 46_000;
    await keeper.tick();
    expect(store.events.length).toBe(2);
    expect(keeper.status()).toMatchObject({ unsaved: false, lastBackupError: null });
    await keeper.stop('SIGTERM');

    // A new container: the restore brings the renewed sign-in, not the one first seeded.
    const next = emptyTarget();
    const r = await restore({ store, ...next, allowEmpty: false, ...quiet });
    expect(r.kind).toBe('restored');
    expect(readFileSync(join(next.layout.codexHome!, 'auth.json'), 'utf8')).toBe('{"invented":"RENEWED"}');
    // The keeper's log lines never hold the file's content.
    expect(logs.join('\n')).not.toContain('RENEWED');
  });

  test('a config.toml that appears is unsaved data too', async () => {
    const store = new FakeStore();
    await seedStore(store, Date.now() - 10_000);
    const t = emptyTarget();
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn, selfTest: noSelfTest, log: () => {}, pollMs: 1_000_000 });
    await keeper.start();
    writeFileSync(join(t.layout.codexHome!, 'config.toml'), 'model = "invented"\n');
    await keeper.tick();
    expect(keeper.status().unsaved).toBe(true);
    const r = await keeper.backup('asked');
    expect(r.ok).toBe(true);
    await keeper.stop('SIGTERM');
    const next = emptyTarget();
    await restore({ store, ...next, allowEmpty: false, ...quiet });
    expect(readFileSync(join(next.layout.codexHome!, 'config.toml'), 'utf8')).toBe('model = "invented"\n');
  });
});

describe('self-test', () => {
  test('only the kind of sign-in is kept, never the words', () => {
    expect(signInKind(0, 'Logged in using ChatGPT\n')).toEqual({ ok: true, detail: 'signed in with ChatGPT' });
    const key = signInKind(0, 'API key configured - sk-proj-***abcd\n');
    expect(key.ok).toBe(true);
    expect(JSON.stringify(key)).not.toContain('abcd');
    expect(signInKind(1, 'Not logged in')).toEqual({ ok: false, detail: 'not signed in' });
    expect(signInKind(null, '')).toMatchObject({ ok: false });
  });
});
