// Tests for the keeper's control endpoint and shutdown (control.ts), which cloud/keeper.ts serves and calls: the
// token, the status, the Codex sign-in beside a real keeper on a fake store, and the stop on SIGTERM. The sign-in's
// command is a fake; nothing here runs Codex, listens on a port or reaches the network.
// Run from the repository root: `bun test cloud`.
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Layout } from './archive.ts';
import { prepareBackup, sendBackup } from './backup.ts';
import type { ChildSpec, Proc } from './children.ts';
import { ANNOUNCE_MS, type LoginSpec } from './codexlogin.ts';
import { Control, NOT_RUNNING } from './control.ts';
import { Keeper } from './keeper.ts';
import type { Check, SelfTest } from './selftest.ts';
import { fakeCodex, fakeTimers, FakeStore, makeDb } from './testing.ts';

const SAMPLE = readFileSync(join(import.meta.dir, 'fixtures', 'codex-device-auth.txt'), 'utf8');
const TOKEN = 'invented-token-'.repeat(4);
const SPEC: LoginSpec = { cmd: ['codex', 'login', '--device-auth'], cwd: '/app', env: { CODEX_HOME: '/data/codex' } };

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'keeper-control-test-'));
  temps.push(dir);
  return dir;
};
// The tests here start and stop processes (a keeper, a sign-in, the app). On a machine busy with another test run that
// takes longer than the 5-second default: each test and this cleanup have a minute.
setDefaultTimeout(60_000);
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

const target = () => {
  const root = temp();
  return { layout: { db: join(root, 'data', 'egg.db'), codexHome: join(root, 'data', 'codex') } as Layout, work: join(root, 'work') };
};

/** A store with one backup, as the keeper restores it at its start. */
async function seededStore(): Promise<FakeStore> {
  const store = new FakeStore();
  const from = target();
  makeDb(from.layout.db);
  mkdirSync(from.layout.codexHome!, { recursive: true });
  writeFileSync(join(from.layout.codexHome!, 'auth.json'), '{"invented":"old sign-in"}');
  const r = await prepareBackup({ layout: from.layout, work: from.work, from: 'seed', last: null, allowShrink: false, now: Date.now() - 10_000 });
  if (r.kind !== 'ready') throw new Error(r.reason);
  await sendBackup(store, r.prepared);
  store.events = [];
  return store;
}

/** A keeper on a fake store with a fake app, and its control endpoint with a fake sign-in command. */
async function setup(o: { store?: FakeStore; start?: boolean; check?: () => Promise<Check> } = {}) {
  const store = o.store ?? (await seededStore());
  const t = target();
  const order: string[] = [];
  const logs: string[] = [];
  const children: ChildSpec[] = [{ name: 'server', cmd: ['true'], cwd: '/', env: {} }];
  const spawn = (): Proc => {
    let exit: (code: number) => void = () => {};
    return { exited: new Promise<number>((resolve) => { exit = resolve; }), kill: () => { order.push('kill server'); exit(0); } };
  };
  const selfTest = async (): Promise<SelfTest> => ({ at: 0, programs: {}, codexSignedIn: { ok: false, detail: 'not signed in' }, codexSandbox: { state: 'unknown', detail: 'test' } });
  const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn, selfTest, log: (l) => logs.push(l), pollMs: 1_000_000, quietMs: 3_600_000, maxWaitMs: 3_600_000 });
  const codex = fakeCodex();
  const timers = fakeTimers();
  let refreshed = 0;
  const control = new Control({
    token: TOKEN,
    keeper,
    login: {
      spec: SPEC,
      spawn: (spec, onText) => { order.push('start codex'); const p = codex.spawn(spec, onText); const kill = p.kill.bind(p); p.kill = (s) => { order.push(`${s} codex`); kill(s); }; return p; },
      check: o.check ?? (async () => ({ ok: true, detail: 'signed in with ChatGPT' })),
      refresh: async () => { refreshed++; },
      log: (l) => logs.push(l),
      timer: timers.timer,
    },
    serverHealthy: async () => true,
    llm: () => ({ ok: true, detail: 'invented readiness' }),
  });
  if (o.start !== false) {
    await keeper.start();
    await Promise.resolve();
  }
  const call = (method: string, path: string, token: string | null = TOKEN) =>
    control.fetch(new Request(`http://keeper${path}`, { method, headers: token === null ? {} : { 'x-egg-token': token } }));
  const body = async (res: Response) => (await res.json()) as Record<string, any>;
  return { control, keeper, store, codex, timers, order, logs, call, body, layout: t.layout, refreshed: () => refreshed };
}

describe("the keeper's control endpoint", () => {
  test('every route needs the token; without it nothing is answered or started', async () => {
    const { call, codex, store, control } = await setup();
    for (const token of [null, '', 'wrong', TOKEN.slice(0, -1), `${TOKEN}x`]) {
      for (const [method, path] of [['GET', '/status'], ['POST', '/backup'], ['POST', '/codex/login'], ['POST', '/codex/cancel'], ['GET', '/nothing']] as const) {
        const res = await call(method, path, token);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'forbidden' });
      }
    }
    expect(codex.runs).toEqual([]);
    expect(store.events).toEqual([]);
    await control.shutdown('SIGTERM');
  });

  test('an empty token refuses everything, even a request that also has none', async () => {
    const s = await setup({ start: false });
    const closed = new Control({ token: '', keeper: s.keeper, login: { spec: SPEC, spawn: s.codex.spawn, check: async () => ({ ok: false, detail: 'test' }), refresh: async () => {}, log: () => {} }, serverHealthy: async () => true, llm: () => null });
    expect((await closed.fetch(new Request('http://keeper/status'))).status).toBe(403);
    expect((await closed.fetch(new Request('http://keeper/status', { headers: { 'x-egg-token': '' } }))).status).toBe(403);
  });

  test('the status has the keeper\'s state, the readiness view and an idle sign-in; other routes are 404', async () => {
    const { call, body, control } = await setup();
    const res = await call('GET', '/status');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toMatchObject({ phase: 'running', busy: false, unsaved: false, serverHealthy: true, llm: { ok: true, detail: 'invented readiness' }, codexLogin: { state: 'idle' } });
    for (const [method, path] of [['GET', '/'], ['POST', '/status'], ['GET', '/codex/login'], ['GET', '/codex/cancel'], ['POST', '/codex'], ['GET', '/backup']] as const) {
      expect((await call(method, path)).status).toBe(404);
    }
    await control.shutdown('SIGTERM');
  });

  test('a sign-in asked for while the keeper does not run the app: 409, and no command starts', async () => {
    // Before the restore has finished.
    const early = await setup({ start: false });
    const a = await early.call('POST', '/codex/login');
    expect(a.status).toBe(409);
    expect(await a.json()).toEqual({ ok: false, error: NOT_RUNNING, codexLogin: { state: 'idle' } });
    expect(early.codex.runs).toEqual([]);

    // After a refused restore (the store holds no backup): the keeper's phase is "failed".
    const failed = await setup({ store: new FakeStore() });
    expect(failed.keeper.status().phase).toBe('failed');
    const b = await failed.call('POST', '/codex/login');
    expect(b.status).toBe(409);
    expect((await failed.body(b)).error).toBe(NOT_RUNNING);
    expect(failed.codex.runs).toEqual([]);
    // The status still answers, and says the sign-in is idle and nothing is in hand.
    expect(await failed.body(await failed.call('GET', '/status'))).toMatchObject({ phase: 'failed', busy: false, serverHealthy: false, codexLogin: { state: 'idle' } });
  });

  test('a sign-in beside a running app: the address and code, `busy` while it waits, and idle after a cancel', async () => {
    const { call, body, codex, control } = await setup();
    const asked = call('POST', '/codex/login');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Already work in hand while Codex has not printed the code yet.
    expect(await body(await call('GET', '/status'))).toMatchObject({ busy: true, codexLogin: { state: 'waiting' } });
    codex.runs[0]!.say(SAMPLE);
    const res = await asked;
    expect(res.status).toBe(200);
    const waiting = { state: 'waiting', url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' };
    expect(await body(res)).toMatchObject({ ok: true, codexLogin: waiting });
    expect(codex.runs[0]!.spec).toEqual(SPEC);

    expect(await body(await call('GET', '/status'))).toMatchObject({ phase: 'running', busy: true, codexLogin: waiting });
    // A second call starts nothing and gets the same two.
    expect(await body(await call('POST', '/codex/login'))).toMatchObject({ ok: true, codexLogin: waiting });
    expect(codex.runs.length).toBe(1);

    const cancelled = await call('POST', '/codex/cancel');
    expect(cancelled.status).toBe(200);
    expect(await body(cancelled)).toMatchObject({ ok: true, codexLogin: { state: 'idle', detail: 'cancelled' } });
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    const after = await body(await call('GET', '/status'));
    expect(after).toMatchObject({ busy: false, codexLogin: { state: 'idle', detail: 'cancelled' } });
    expect(after.codexLogin.code).toBeUndefined();
    await control.shutdown('SIGTERM');
  });

  test('a sign-in that gets no code: 502 with the failure, and nothing stays in hand', async () => {
    const { call, body, codex, timers, control } = await setup();
    const asked = call('POST', '/codex/login');
    await new Promise((resolve) => setTimeout(resolve, 0));
    codex.runs[0]!.say('error: could not reach the sign-in service\n');
    timers.fire(ANNOUNCE_MS);
    const res = await asked;
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({ ok: false, codexLogin: { state: 'failed', detail: 'codex printed no address and code in 20 s' } });
    expect(await body(await call('GET', '/status'))).toMatchObject({ busy: false, codexLogin: { state: 'failed' } });
    await control.shutdown('SIGTERM');
  });

  test('after a sign-in: the status takes the new check, the readiness view is read again, and the keeper backs up at once', async () => {
    const { call, body, codex, control, keeper, store, layout, refreshed, logs } = await setup();
    expect(keeper.status().selfTest!.codexSignedIn).toEqual({ ok: false, detail: 'not signed in' });
    const asked = call('POST', '/codex/login');
    await new Promise((resolve) => setTimeout(resolve, 0));
    codex.runs[0]!.say(SAMPLE);
    await asked;
    expect(store.events).toEqual([]);

    // The owner typed the code: Codex writes the sign-in and exits 0.
    writeFileSync(join(layout.codexHome!, 'auth.json'), '{"invented":"new sign-in"}');
    codex.runs[0]!.exit(0);
    await control.login.settled();

    const status = await body(await call('GET', '/status'));
    expect(status).toMatchObject({ busy: false, unsaved: false, lastBackupError: null, codexLogin: { state: 'done', detail: 'signed in with ChatGPT' }, selfTest: { codexSignedIn: { ok: true, detail: 'signed in with ChatGPT' } } });
    expect(status.codexLogin.code).toBeUndefined();
    expect(refreshed()).toBe(1);
    expect(store.events.map((e) => e.split(' ')[0])).toEqual(['upload', 'commit']);
    expect(logs.some((l) => l.includes('backed up (signed in)'))).toBe(true);
    expect(logs.join('\n')).not.toContain('new sign-in');
    await control.shutdown('SIGTERM');
  });

  test('a backup asked for goes to the keeper', async () => {
    const { call, body, store, layout, control } = await setup();
    expect(await body(await call('POST', '/backup'))).toEqual({ ok: true, reason: 'nothing changed since the last backup' });
    writeFileSync(join(layout.db, '..', 'profile.md'), '# Invented change');
    const res = await call('POST', '/backup');
    expect(res.status).toBe(200);
    expect((await body(res)).ok).toBe(true);
    expect(store.events.length).toBe(2);
    await control.shutdown('SIGTERM');
    // Once the keeper has stopped there is nothing to back up: 409.
    expect((await call('POST', '/backup')).status).toBe(409);
  });
});

describe('the shutdown', () => {
  test('SIGTERM: a sign-in that waits is stopped first, then the app, and the keeper exits 0', async () => {
    const { call, codex, control, keeper, order } = await setup();
    const asked = call('POST', '/codex/login');
    await new Promise((resolve) => setTimeout(resolve, 0));
    codex.runs[0]!.say(SAMPLE);
    await asked;

    expect(control.stopping).toBe(false);
    const code = await control.shutdown('SIGTERM');
    expect(code).toBe(0);
    expect(control.stopping).toBe(true);
    expect(order).toEqual(['start codex', 'SIGTERM codex', 'kill server']);
    expect(keeper.status().phase).toBe('stopped');
    expect(control.login.status()).toMatchObject({ state: 'idle', detail: 'cancelled' });
    expect(control.login.waiting).toBe(false);
  });

  test('a sign-in asked for once the keeper stops is refused, and starts no command', async () => {
    const { call, body, codex, control, keeper } = await setup();
    const asked = call('POST', '/codex/login');
    await new Promise((resolve) => setTimeout(resolve, 0));
    codex.runs[0]!.say(SAMPLE);
    await asked;

    // The command ignores SIGTERM for now, so the shutdown is held at the cancel: the keeper's phase is still "running".
    codex.runs[0]!.stubborn = true;
    const stopped = control.shutdown('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keeper.status().phase).toBe('running');
    const during = await call('POST', '/codex/login');
    expect(during.status).toBe(409);
    expect((await body(during)).error).toBe(NOT_RUNNING);
    expect(codex.runs.length).toBe(1);

    codex.runs[0]!.exit(143);
    expect(await stopped).toBe(0);
    const after = await call('POST', '/codex/login');
    expect(after.status).toBe(409);
    expect(codex.runs.length).toBe(1);
    // A cancel is still answered, and changes nothing.
    expect((await call('POST', '/codex/cancel')).status).toBe(200);
  });

  test('a second signal does not stop the keeper twice', async () => {
    const { control, order } = await setup();
    const first = control.shutdown('SIGTERM');
    const second = control.shutdown('SIGINT');
    expect(second).toBe(first);
    expect(await first).toBe(0);
    expect(order).toEqual(['kill server']);
  });

  test('with no sign-in in hand the shutdown is the keeper\'s own: the app stops and unsaved data is backed up', async () => {
    const { control, store, layout, keeper } = await setup();
    writeFileSync(join(layout.db, '..', 'profile.md'), '# Invented change');
    await keeper.tick();
    expect(await control.shutdown('SIGTERM')).toBe(0);
    expect(store.events.map((e) => e.split(' ')[0])).toEqual(['upload', 'commit']);
  });
});
