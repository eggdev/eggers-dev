// Tests for the publish step of the public collection (publish.ts) with two fake buckets (CONTENT, which the public
// website reads, and the private DATA) and a fake server answer: what is written and where, every refusal, the
// history in the private bucket and its pruning beside backups, and unpublish. The Access check and the same-origin
// rule in front of these paths are tested through the whole Worker in studio.test.ts.
// Run from studio/: `bun run test`.
import { describe, expect, test } from 'bun:test';
import { FakeBucket } from './fake-bucket.ts';
import { MESSAGES } from './messages.ts';
import { backupKey, manifestKey, POINTER } from '../../cloud/lib/manifest.ts';
import { completeBackups, handleBackup } from './backups.ts';
import { COLLECTION_KEY, HISTORY_KEEP, HISTORY_PREFIX, historyKey, live, MAX_CHARS, publish, unpublish } from './publish.ts';

const hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const TEXT = '# An invented person\n\nThey built an invented thing, with an accent: café.\n';
const T0 = Date.UTC(2026, 10, 16, 18, 30, 5, 123);
const MINUTE = 60_000;

/** The server's GET /public answer for a saved text, as lib/public.ts makes it. */
const savedAnswer = async (text: string) => ({ text, savedAt: 1_700_000_000_000, sha256: text === '' ? null : await hex(text), notes: [] });

/** `bucket` is CONTENT, the one the public website reads; `data` is the private DATA, where the history goes. */
function setup(saved: () => Response | Promise<Response>) {
  const bucket = new FakeBucket();
  const data = new FakeBucket();
  const logs: string[] = [];
  const clock = { now: T0 };
  let asked = 0;
  const d = { bucket, history: data, saved: async () => { asked++; return saved(); }, now: () => clock.now, log: (m: string) => { logs.push(m); } };
  return { bucket, data, logs, clock, d, asked: () => asked };
}
const withText = async (text: string) => {
  const answer = await savedAnswer(text);
  return { ...setup(() => Response.json(answer)), sha256: answer.sha256 as string };
};
const request = (body: unknown) => new Request('https://studio.eggers.dev/api/_studio/publish', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const writes = (bucket: FakeBucket) => bucket.ops.filter((op) => op.startsWith('put') || op.startsWith('delete'));
const error = async (res: Response) => ((await res.json()) as { error: string }).error;

describe('publish', () => {
  test('writes the history copy to the private bucket, then collection.md to the public one, both as markdown with the sha256 and the time', async () => {
    const { bucket, data, d, sha256, logs } = await withText(TEXT);
    const order: string[] = [];
    for (const [name, b] of [['DATA', data], ['CONTENT', bucket]] as const) {
      const put = b.put.bind(b);
      b.put = async (key, value, options) => { order.push(`${name} ${key}`); return put(key, value, options); };
    }
    const res = await publish(request({ sha256 }), d);
    expect(res.status).toBe(200);
    const size = new TextEncoder().encode(TEXT).length;
    expect(await res.json()).toEqual({ ok: true, live: { sha256, publishedAt: '2026-11-16T18:30:05.123Z', size } });
    expect(res.headers.get('cache-control')).toBe('no-store');

    const history = 'public-history/2026-11-16T18-30-05-123Z.md';
    expect(order).toEqual([`DATA ${history}`, `CONTENT ${COLLECTION_KEY}`]);
    // The bucket the public website reads holds collection.md and nothing else: no history, ever.
    expect([...bucket.objects.keys()]).toEqual([COLLECTION_KEY]);
    expect(writes(bucket)).toEqual([`put ${COLLECTION_KEY}`]);
    expect([...data.objects.keys()]).toEqual([history]);
    for (const [b, key] of [[data, history], [bucket, COLLECTION_KEY]] as const) {
      expect(new TextDecoder().decode(b.objects.get(key))).toBe(TEXT);
      expect(b.meta.get(key)!.httpMetadata).toEqual({ contentType: 'text/markdown; charset=utf-8' });
      expect(b.meta.get(key)!.customMetadata).toEqual({ sha256, publishedAt: '2026-11-16T18:30:05.123Z' });
    }
    // The sha256 in the metadata is the sha256 of the bytes in the bucket.
    expect(await hex(new TextDecoder().decode(bucket.objects.get(COLLECTION_KEY)))).toBe(sha256);
    expect(logs).toEqual([`publish: 2026-11-16T18:30:05.123Z sha256 ${sha256}`]);
  });

  test('the history key is the ISO time with ":" and "." replaced by "-"', () => {
    expect(HISTORY_PREFIX).toBe('public-history/');
    expect(historyKey('2026-11-16T18:30:05.123Z')).toBe('public-history/2026-11-16T18-30-05-123Z.md');
  });

  test('nothing saved: 409, nothing written', async () => {
    const { bucket, data, d } = await withText('');
    const res = await publish(request({ sha256: 'a'.repeat(64) }), d);
    expect(res.status).toBe(409);
    expect(await error(res)).toBe(MESSAGES.nothingSaved);
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
  });

  test('the saved text is not the text that was reviewed: 409 that says to review it again', async () => {
    const { bucket, data, d } = await withText(TEXT);
    const res = await publish(request({ sha256: await hex('the text as it was when the owner reviewed it') }), d);
    expect(res.status).toBe(409);
    expect(await error(res)).toBe('The saved text changed after you reviewed it. Review it again.');
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
  });

  test("the text does not match the server's sha256: 409, nothing written", async () => {
    // The server says the sha256 the owner reviewed, but sends another text with it.
    const sha256 = await hex(TEXT);
    const { bucket, data, d, logs } = setup(() => Response.json({ text: `${TEXT}one more line\n`, savedAt: 1, sha256, notes: [] }));
    const res = await publish(request({ sha256 }), d);
    expect(res.status).toBe(409);
    expect(await error(res)).toBe(MESSAGES.checksum);
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
    expect(logs.join('\n')).not.toContain('invented');
  });

  test('a text of white space only: 409', async () => {
    for (const blank of [' ', '\n\n\t  \n']) {
      const { bucket, data, d, sha256 } = await withText(blank);
      const res = await publish(request({ sha256 }), d);
      expect(res.status).toBe(409);
      expect(await error(res)).toBe(MESSAGES.emptyText);
      expect(bucket.ops).toEqual([]);
      expect(data.ops).toEqual([]);
    expect(data.ops).toEqual([]);
    }
  });

  test('a text longer than 120,000 characters: 409; one of exactly 120,000 is published', async () => {
    expect(MAX_CHARS).toBe(120_000);
    const long = await withText('x'.repeat(MAX_CHARS + 1));
    const refused = await publish(request({ sha256: long.sha256 }), long.d);
    expect(refused.status).toBe(409);
    expect(await error(refused)).toBe(MESSAGES.tooLong);
    expect(long.bucket.ops).toEqual([]);
    expect(long.data.ops).toEqual([]);
    const most = await withText('x'.repeat(MAX_CHARS));
    expect((await publish(request({ sha256: most.sha256 }), most.d)).status).toBe(200);
  });

  test('a body without a sha256 of the right form: 400, and the server is not asked', async () => {
    const { bucket, data, d, asked } = await withText(TEXT);
    for (const body of ['', 'not json', {}, { sha256: 7 }, { sha256: 'abc' }, { sha256: 'A'.repeat(64) }, { sha256: `${'a'.repeat(64)} ` }]) {
      const res = await publish(request(body), d);
      expect(res.status).toBe(400);
      expect(await error(res)).toBe(MESSAGES.publishBody);
    }
    expect(asked()).toBe(0);
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
  });

  test('a text in the request is ignored: only the saved text is ever published', async () => {
    const { bucket, d, sha256 } = await withText(TEXT);
    await publish(request({ sha256, text: 'a text of the page own making' }), d);
    expect(new TextDecoder().decode(bucket.objects.get(COLLECTION_KEY))).toBe(TEXT);
  });

  test('a container that is starting or not answering: its answer passes through, nothing is written', async () => {
    const starting = setup(() => Response.json({ error: MESSAGES.starting }, { status: 503, headers: { 'retry-after': '5' } }));
    const a = await publish(request({ sha256: 'a'.repeat(64) }), starting.d);
    expect(a.status).toBe(503);
    expect(a.headers.get('retry-after')).toBe('5');
    expect(await error(a)).toBe(MESSAGES.starting);
    expect(starting.bucket.ops).toEqual([]);
    expect(starting.data.ops).toEqual([]);

    const down = setup(() => Response.json({ error: MESSAGES.containerDown }, { status: 502 }));
    const b = await publish(request({ sha256: 'a'.repeat(64) }), down.d);
    expect(b.status).toBe(502);
    expect(await error(b)).toBe(MESSAGES.containerDown);

    const thrown = setup(() => { throw new Error('internal error'); });
    const c = await publish(request({ sha256: 'a'.repeat(64) }), thrown.d);
    expect(c.status).toBe(502);
    expect(await error(c)).toBe(MESSAGES.containerDown);
    expect(thrown.bucket.ops).toEqual([]);
    expect(thrown.data.ops).toEqual([]);
  });

  test('a server without the route, or an answer that is not the saved text: 502, nothing written', async () => {
    const answers = [
      () => Response.json({ error: 'Not found' }, { status: 404 }),
      () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => Response.json({ sha256: 'a'.repeat(64) }),
      () => Response.json({ text: TEXT }),
      () => Response.json({ text: 5, sha256: 'a'.repeat(64) }),
    ];
    for (const answer of answers) {
      const { bucket, data, d } = setup(answer);
      const res = await publish(request({ sha256: 'a'.repeat(64) }), d);
      expect(res.status).toBe(502);
      expect(await error(res)).toBe(MESSAGES.savedUnreadable);
      expect(bucket.ops).toEqual([]);
      expect(data.ops).toEqual([]);
    expect(data.ops).toEqual([]);
    }
  });

  test('a bucket write that fails: 502, and what was live stays live', async () => {
    const { bucket, data, d, sha256, clock } = await withText(TEXT);
    await publish(request({ sha256 }), d);
    const before = bucket.meta.get(COLLECTION_KEY)!.customMetadata;
    clock.now += MINUTE;
    bucket.fail.add(`put ${COLLECTION_KEY}`);
    const res = await publish(request({ sha256 }), d);
    expect(res.status).toBe(502);
    expect(await error(res)).toBe(MESSAGES.bucketFailed);
    expect(bucket.meta.get(COLLECTION_KEY)!.customMetadata).toEqual(before);

    // A history write that fails stops the publish before the public bucket is written.
    bucket.fail.clear();
    bucket.ops.length = 0;
    clock.now += MINUTE;
    data.fail.add(`put ${historyKey(new Date(clock.now).toISOString())}`);
    const second = await publish(request({ sha256 }), d);
    expect(second.status).toBe(502);
    expect(bucket.ops).toEqual([]);
  });
});

describe('the history, in the private bucket', () => {
  test('only the newest 20 copies are kept', async () => {
    const { bucket, data, d, sha256, clock } = await withText(TEXT);
    const keys: string[] = [];
    for (let i = 0; i < HISTORY_KEEP + 5; i++) {
      clock.now = T0 + i * MINUTE;
      keys.push(historyKey(new Date(clock.now).toISOString()));
      expect((await publish(request({ sha256 }), d)).status).toBe(200);
    }
    expect(HISTORY_KEEP).toBe(20);
    expect([...data.objects.keys()].sort()).toEqual(keys.slice(5));
    expect(data.deleted.sort()).toEqual(keys.slice(0, 5));
    // The public bucket: collection.md only, and nothing was ever deleted or listed there.
    expect([...bucket.objects.keys()]).toEqual([COLLECTION_KEY]);
    expect(bucket.ops.every((op) => op === `put ${COLLECTION_KEY}`)).toBe(true);
  });

  test('pruning touches only history copies of its own form', async () => {
    const { data, d, sha256, clock } = await withText(TEXT);
    const others = ['public-history/notes-from-someone.md', 'public-history/2020-01-01T00-00-00-000Z.md.bak', 'public-history/2020-01-01T00-00-00-000Z.tar.gz', 'public-history/sub/2020-01-01T00-00-00-000Z.md'];
    for (const key of others) data.objects.set(key, new Uint8Array(1));
    for (let i = 0; i < HISTORY_KEEP + 2; i++) {
      clock.now = T0 + i * MINUTE;
      await publish(request({ sha256 }), d);
    }
    for (const key of others) expect(data.objects.has(key)).toBe(true);
    expect(data.deleted.length).toBe(2);
    expect(data.deleted.every((k) => /^public-history\/2026-11-16T18-3[01]-05-123Z\.md$/.test(k))).toBe(true);
  });

  test('a pruning that fails does not fail the publish', async () => {
    const { data, d, sha256, logs } = await withText(TEXT);
    data.fail.add('list public-history/');
    const res = await publish(request({ sha256 }), d);
    expect(res.status).toBe(200);
    expect(logs.join('\n')).toContain('the history could not be pruned');
  });
});

// The private bucket holds the backups too. Neither side may take the other's objects for its own.
describe('history copies beside backups in the private bucket', () => {
  const GATEWAY_TOKEN = 'invented-gateway-token';
  const DAY = 86_400_000;
  const manifestOf = (at: number) => ({ format: 1, key: backupKey(at), createdAt: at, size: 4, sha256: 'a'.repeat(64), db: { bytes: 1, roles: 1, facts: 1, jobs: 0 }, files: 1, from: 'keeper' });
  /** Puts complete backups (archive and manifest) at these times, and the pointer at the newest. */
  async function backups(data: FakeBucket, times: number[]) {
    for (const at of times) {
      data.objects.set(backupKey(at), new Uint8Array(4));
      await data.put(manifestKey(backupKey(at)), JSON.stringify(manifestOf(at)));
    }
    await data.put(POINTER, JSON.stringify(manifestOf(Math.max(...times))));
    data.ops.length = 0;
    data.deleted.length = 0;
  }
  const gateway = (data: FakeBucket, now: number, path: string, init: RequestInit = {}) =>
    handleBackup(new Request(`http://backup.internal${path}`, { ...init, headers: { 'x-egg-token': GATEWAY_TOKEN } }), { bucket: data, token: GATEWAY_TOKEN, now: () => now, log: () => {} });

  test('pruning the history never deletes a backup, a manifest or the pointer', async () => {
    const { data, d, sha256, clock } = await withText(TEXT);
    const times = [T0 - 3 * DAY, T0 - 2 * DAY, T0 - DAY];
    await backups(data, times);
    const before = [...data.objects.keys()].filter((k) => !k.startsWith(HISTORY_PREFIX)).sort();
    for (let i = 0; i < HISTORY_KEEP + 6; i++) {
      clock.now = T0 + i * MINUTE;
      expect((await publish(request({ sha256 }), d)).status).toBe(200);
    }
    expect(data.deleted.length).toBe(6);
    expect(data.deleted.every((k) => k.startsWith(HISTORY_PREFIX))).toBe(true);
    expect([...data.objects.keys()].filter((k) => !k.startsWith(HISTORY_PREFIX)).sort()).toEqual(before);
    // Its listing asked for the history's own prefix only.
    expect(data.ops.filter((op) => op.startsWith('list'))).toEqual(Array(HISTORY_KEEP + 6).fill('list public-history/'));
  });

  test('the backup gateway never lists, reads, counts or deletes a history copy', async () => {
    const { data, d, sha256, clock } = await withText(TEXT);
    // Forty daily backups, so the retention rule has backups to delete; then some history copies, old and new.
    const now = T0 + DAY;
    const times = Array.from({ length: 40 }, (_, i) => T0 - (i + 31) * DAY);
    await backups(data, [...times, T0]);
    for (const at of [T0 - 400 * DAY, T0 - 100 * DAY, T0]) {
      clock.now = at;
      await publish(request({ sha256 }), d);
    }
    // And objects made to look as much like backups as a history key can.
    const tricks = ['public-history/2020-01-01T00-00-00-000Z.tar.gz', 'public-history/2020-01-01T00-00-00-000Z.json', 'public-history/latest.json'];
    await data.put(tricks[0]!, 'not an archive');
    await data.put(tricks[1]!, JSON.stringify({ ...manifestOf(0), key: tricks[0] }));
    await data.put(tricks[2]!, JSON.stringify(manifestOf(T0)));
    const history = [...data.objects.keys()].filter((k) => k.startsWith(HISTORY_PREFIX)).sort();
    expect(history.length).toBe(6);
    data.ops.length = 0;
    data.deleted.length = 0;

    // The index: the pointer and the complete backups, and nothing of the history.
    const index = (await (await gateway(data, now, '/index')).json()) as { latest: { key: string }; backups: { key: string }[] };
    expect(index.latest.key).toBe(backupKey(T0));
    expect(index.backups.length).toBe(41);
    expect(index.backups.every((m) => m.key.startsWith('backups/'))).toBe(true);
    expect((await completeBackups(data)).some((m) => m.key.startsWith(HISTORY_PREFIX))).toBe(false);

    // The container cannot read, replace or commit a history copy through the gateway.
    for (const key of history) {
      expect((await gateway(data, now, `/object?key=${encodeURIComponent(key)}`)).status).toBe(400);
      expect((await gateway(data, now, `/upload/start?key=${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify(manifestOf(T0)) })).status).toBe(400);
      expect((await gateway(data, now, '/commit', { method: 'POST', body: JSON.stringify({ key }) })).status).toBe(400);
    }

    // A commit runs the retention rule: old backups go, every history copy stays.
    const committed = await gateway(data, now, '/commit', { method: 'POST', body: JSON.stringify({ key: backupKey(T0) }) });
    expect(committed.status).toBe(200);
    expect(((await committed.json()) as { pruned: number }).pruned).toBeGreaterThan(0);
    expect(data.deleted.length).toBeGreaterThan(0);
    expect(data.deleted.every((k) => k.startsWith('backups/'))).toBe(true);
    expect([...data.objects.keys()].filter((k) => k.startsWith(HISTORY_PREFIX)).sort()).toEqual(history);
    // No call of the gateway named a history key: it listed backups/ and touched backup keys and the pointer only.
    expect(data.ops.some((op) => op.includes(HISTORY_PREFIX))).toBe(false);
    expect(data.ops.filter((op) => op.startsWith('list')).every((op) => op === 'list backups/')).toBe(true);
  });
});

describe('the public state and unpublish', () => {
  test('nothing published: {live: null}', async () => {
    const { bucket, d } = await withText(TEXT);
    const res = await live(d);
    expect(await res.json()).toEqual({ live: null });
    expect(bucket.ops).toEqual([`head ${COLLECTION_KEY}`]);
  });

  test('the public state comes from a head: the metadata and the size, never the body', async () => {
    const { bucket, d, sha256 } = await withText(TEXT);
    await publish(request({ sha256 }), d);
    bucket.ops.length = 0;
    const res = await live(d);
    expect(await res.json()).toEqual({ live: { sha256, publishedAt: '2026-11-16T18:30:05.123Z', size: new TextEncoder().encode(TEXT).length } });
    expect(bucket.ops).toEqual([`head ${COLLECTION_KEY}`]);
  });

  test('an object that another tool put there has no sha256', async () => {
    const { bucket, d } = await withText(TEXT);
    await bucket.put(COLLECTION_KEY, 'put by hand');
    const body = (await (await live(d)).json()) as { live: { sha256: string | null; publishedAt: string | null; size: number } };
    expect(body.live.sha256).toBeNull();
    expect(body.live.size).toBe(11);
    // The time is the object's upload time when no publish recorded one.
    expect(body.live.publishedAt).toBe(bucket.meta.get(COLLECTION_KEY)!.uploaded.toISOString());
  });

  test('unpublish deletes collection.md and keeps the history; the public bucket is then empty', async () => {
    const { bucket, data, d, sha256, logs, clock } = await withText(TEXT);
    await publish(request({ sha256 }), d);
    clock.now += MINUTE;
    const res = await unpublish(d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, live: null });
    expect([...bucket.objects.keys()]).toEqual([]);
    expect(bucket.deleted).toEqual([COLLECTION_KEY]);
    expect([...data.objects.keys()]).toEqual(['public-history/2026-11-16T18-30-05-123Z.md']);
    expect(data.deleted).toEqual([]);
    expect(logs.at(-1)).toBe(`unpublish: 2026-11-16T18:31:05.123Z sha256 ${sha256}`);
    expect(await (await live(d)).json()).toEqual({ live: null });
  });

  test('unpublish with nothing published still answers ok; it deletes even when the head fails', async () => {
    const { bucket, d, logs } = await withText(TEXT);
    expect(await (await unpublish(d)).json()).toEqual({ ok: true, live: null });
    expect(logs.at(-1)).toContain('none (nothing was published)');
    await bucket.put(COLLECTION_KEY, 'live text');
    bucket.fail.add(`head ${COLLECTION_KEY}`);
    expect((await unpublish(d)).status).toBe(200);
    expect(bucket.objects.has(COLLECTION_KEY)).toBe(false);
  });

  test('a bucket that fails: 502, never a false "ok"', async () => {
    const { bucket, d } = await withText(TEXT);
    await bucket.put(COLLECTION_KEY, 'live text');
    bucket.fail.add(`delete ${COLLECTION_KEY}`);
    const res = await unpublish(d);
    expect(res.status).toBe(502);
    expect(await error(res)).toBe(MESSAGES.bucketFailed);
    bucket.fail.add(`head ${COLLECTION_KEY}`);
    expect((await live(d)).status).toBe(502);
  });
});
