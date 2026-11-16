// Tests for the backup gateway with a bucket in memory, driven by the keeper's own client (cloud/lib/store.ts) over
// real HTTP on this machine, so both ends of the protocol are tested together. Run from studio/: `bun run test`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBackup } from '../../cloud/lib/backup.ts';
import { backupKey, manifestKey, POINTER, type Manifest } from '../../cloud/lib/manifest.ts';
import { HttpStore } from '../../cloud/lib/store.ts';
import { makeDb } from '../../cloud/lib/testing.ts';
import { handleBackup, MAX_PART_BYTES } from './backups.ts';
import { FakeBucket } from './fake-bucket.ts';

const TOKEN = 'a'.repeat(64);
let bucket: FakeBucket;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let clock = Date.UTC(2026, 10, 16, 12);
const dirs: string[] = [];

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: (r) => handleBackup(r, { bucket, token: TOKEN, now: () => clock, log: () => {} }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  server.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A prepared backup of a tiny invented database with this many facts. */
async function prepared(at: number, facts = 5) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-test-'));
  dirs.push(dir);
  makeDb(join(dir, 'data', 'egg.db'), 2, facts);
  const r = await prepareBackup({ layout: { db: join(dir, 'data', 'egg.db'), codexHome: null }, work: join(dir, 'work'), from: 'keeper', last: null, allowShrink: false, now: at });
  if (r.kind !== 'ready') throw new Error(r.reason);
  return r.prepared;
}

describe('the backup gateway', () => {
  test('refuses a request without this start’s token', async () => {
    bucket = new FakeBucket();
    for (const headers of [{}, { 'x-egg-token': 'b'.repeat(64) }, { 'x-egg-token': TOKEN.slice(1) }]) {
      const res = await fetch(`${base}/index`, { headers });
      expect(res.status).toBe(403);
    }
    // An empty token in the props refuses everything, even an empty header.
    const res = await handleBackup(new Request('http://backup.internal/index', { headers: { 'x-egg-token': '' } }), { bucket, token: '', now: () => clock, log: () => {} });
    expect(res.status).toBe(403);
  });

  test('an empty bucket answers "no backup": no pointer, no backups', async () => {
    bucket = new FakeBucket();
    const store = new HttpStore(base, TOKEN);
    expect(await store.index()).toEqual({ latest: null, backups: [] });
  });

  test('a multipart upload, then the commit: the pointer is written after the archive and its manifest', async () => {
    bucket = new FakeBucket();
    const p = await prepared(clock, 400);
    // Parts of 1 KiB: several parts for this archive. (R2 itself needs 5 MiB parts; the fake does not.)
    const store = new HttpStore(base, TOKEN, fetch, 1024);
    await store.upload(p.file, p.manifest);
    expect(bucket.uploads.get('upload-1')!.parts.size).toBeGreaterThan(1);
    expect(bucket.objects.has(POINTER)).toBe(false);
    // Uploaded but not committed: listed as a backup, not yet the one to restore.
    expect((await store.index()).latest).toBeNull();
    await store.commit(p.manifest.key);
    const index = await store.index();
    expect(index.latest).toEqual(p.manifest);
    expect(index.backups.map((m) => m.key)).toEqual([p.manifest.key]);

    // The download is the same bytes.
    const out = join(dirs[0]!, 'down.tar.gz');
    await store.download(p.manifest.key, out);
    expect(Bun.hash(await Bun.file(out).arrayBuffer())).toBe(Bun.hash(await Bun.file(p.file).arrayBuffer()));
  });

  test('an archive whose manifest never arrived is not listed and cannot be committed', async () => {
    bucket = new FakeBucket();
    const p = await prepared(clock);
    bucket.objects.set(p.manifest.key, new Uint8Array(await Bun.file(p.file).arrayBuffer()));
    const store = new HttpStore(base, TOKEN);
    expect((await store.index()).backups).toEqual([]);
    await expect(store.commit(p.manifest.key)).rejects.toThrow('409');
    expect(bucket.objects.has(POINTER)).toBe(false);
  });

  test('a backup that exists is never replaced', async () => {
    bucket = new FakeBucket();
    const p = await prepared(clock);
    const store = new HttpStore(base, TOKEN);
    await store.upload(p.file, p.manifest);
    await expect(store.upload(p.file, p.manifest)).rejects.toThrow('409');
  });

  test('a size that does not match the manifest: the upload is deleted and fails', async () => {
    bucket = new FakeBucket();
    const p = await prepared(clock);
    const store = new HttpStore(base, TOKEN);
    const lying: Manifest = { ...p.manifest, size: p.manifest.size + 1 };
    await expect(store.upload(p.file, lying)).rejects.toThrow('400');
    expect(bucket.objects.has(p.manifest.key)).toBe(false);
    expect(bucket.objects.has(manifestKey(p.manifest.key))).toBe(false);
  });

  test('only backup archive keys: no other object can be read or written', async () => {
    bucket = new FakeBucket();
    await bucket.put(POINTER, '{"secret":1}');
    for (const key of [POINTER, 'backups/../latest.json', 'other/thing', 'backups/x.json']) {
      const get = await fetch(`${base}/object?key=${encodeURIComponent(key)}`, { headers: { 'x-egg-token': TOKEN } });
      expect(get.status).toBe(400);
      const start = await fetch(`${base}/upload/start?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'x-egg-token': TOKEN }, body: '{}' });
      expect(start.status).toBe(400);
    }
    const unknown = await fetch(`${base}/delete?key=${encodeURIComponent(backupKey(clock))}`, { method: 'POST', headers: { 'x-egg-token': TOKEN } });
    expect(unknown.status).toBe(400);
  });

  test('a part over 100 MiB is refused before it is read', async () => {
    bucket = new FakeBucket();
    const key = backupKey(clock);
    const res = await handleBackup(new Request(`http://backup.internal/upload/part?key=${key}&uploadId=u&part=1`, {
      method: 'PUT', headers: { 'x-egg-token': TOKEN, 'content-length': String(MAX_PART_BYTES + 1) }, body: 'x',
    }), { bucket, token: TOKEN, now: () => clock, log: () => {} });
    expect(res.status).toBe(413);
  });

  test('retention runs after each commit and never deletes the pointer’s backup', async () => {
    bucket = new FakeBucket();
    const store = new HttpStore(base, TOKEN);
    const start = clock;
    // 33 backups an hour apart on one day: the newest 30 stay, plus the newest of the day (already among them).
    const keys: string[] = [];
    for (let i = 0; i < 33; i++) {
      clock = start + i * 3_600_000 / 4;
      const p = await prepared(clock);
      await store.upload(p.file, p.manifest);
      await store.commit(p.manifest.key);
      keys.push(p.manifest.key);
    }
    const index = await store.index();
    expect(index.backups.length).toBe(30);
    expect(index.latest!.key).toBe(keys.at(-1)!);
    expect(bucket.objects.has(keys[0]!)).toBe(false);
    expect(bucket.objects.has(manifestKey(keys[0]!))).toBe(false);
    expect(bucket.objects.has(keys[3]!)).toBe(true);
    clock = start;
  });
});
