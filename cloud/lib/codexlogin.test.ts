// Tests for the Codex sign-in made in the container (codexlogin.ts) with a fake command, fake timers and, for the
// backup, a real keeper on a fake store. Nothing here runs Codex or reaches the network.
// fixtures/codex-device-auth.txt is what `codex login --device-auth` of Codex 0.169.0 really printed (standard
// output, with its colour codes), with the one-time code replaced by an invented one.
// Run from the repository root: `bun test cloud`.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Layout } from './archive.ts';
import { prepareBackup, sendBackup } from './backup.ts';
import type { ChildSpec, Proc } from './children.ts';
import { ANNOUNCE_MS, CodexLogin, LIMIT_MS, LOGIN_MESSAGES, parseDeviceAuth, SIGN_IN_HOST, type CodexLoginStatus, type LoginDeps, type LoginSpec } from './codexlogin.ts';
import { Keeper } from './keeper.ts';
import { restore } from './restore.ts';
import type { Check, SelfTest } from './selftest.ts';
import { fakeCodex, fakeTimers, FakeStore, makeDb } from './testing.ts';

const SAMPLE = readFileSync(join(import.meta.dir, 'fixtures', 'codex-device-auth.txt'), 'utf8');
const URL_IN_SAMPLE = 'https://auth.openai.com/codex/device';
const CODE_IN_SAMPLE = 'ABCD-12345';
const ESC = String.fromCharCode(27);

describe('the device sign-in output', () => {
  test('the captured sample: the address and the code, without the colour codes', () => {
    expect(SAMPLE).toContain(`${ESC}[94m${CODE_IN_SAMPLE}${ESC}[0m`);
    expect(parseDeviceAuth(SAMPLE)).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
  });

  test('the same words without colour, and with Windows line ends', () => {
    const plain = SAMPLE.replaceAll(/\x1b\[[0-9;]*m/g, '');
    expect(plain).not.toContain(ESC);
    expect(parseDeviceAuth(plain)).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
    expect(parseDeviceAuth(plain.replaceAll('\n', '\r\n'))).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
  });

  test('other colour and terminal codes around the two values', () => {
    const noisy = `${ESC}]0;codex${ESC}\\${ESC}[1;38;5;12mhttps://auth.openai.com/device?x=1${ESC}[0m${ESC}[K\n   ${ESC}[1m${ESC}[4mWXYZ-9876${ESC}[0m\n`;
    expect(parseDeviceAuth(noisy)).toEqual({ url: 'https://auth.openai.com/device?x=1', code: 'WXYZ-9876' });
  });

  test('another https address printed before the real one is ignored', () => {
    expect(SIGN_IN_HOST).toBe('auth.openai.com');
    const notice = 'A new version is out. See https://updates.example.com/codex/releases/latest for the notes.\n';
    expect(parseDeviceAuth(notice + SAMPLE)).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
    // On the same line as the real one, too.
    expect(parseDeviceAuth(`Docs https://docs.example.com/sign-in then ${URL_IN_SAMPLE}\n${CODE_IN_SAMPLE}\n`)).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
  });

  test('an address on any other host is never the sign-in address, however it is written', () => {
    const others = [
      'https://updates.example.com/codex/device',
      'https://auth.openai.com.example.com/codex/device',
      'https://auth.openai.com@example.com/codex/device',
      'https://example.com/auth.openai.com/codex/device',
      'https://example.com/?next=auth.openai.com',
      'https://xauth.openai.com/codex/device',
      'https://openai.com/codex/device',
      'https://auth.openai.com:8443/codex/device',
      'http://auth.openai.com/codex/device',
    ];
    for (const other of others) expect(parseDeviceAuth(`${other}\n${CODE_IN_SAMPLE}\n`)).toBeNull();
    expect(parseDeviceAuth(SAMPLE.replace(URL_IN_SAMPLE, 'https://sign-in.example.com/codex/device'))).toBeNull();
  });

  test('nothing is taken before both are there, and a code that arrived in part is not the code', () => {
    const codeAt = SAMPLE.indexOf(CODE_IN_SAMPLE);
    for (let end = 0; end < SAMPLE.length; end++) {
      const found = parseDeviceAuth(SAMPLE.slice(0, end));
      // Null until the code's whole line is there; from then on, the whole code and never a part of it.
      if (end <= codeAt + CODE_IN_SAMPLE.length) expect(found).toBeNull();
      else if (found) expect(found).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
    }
    expect(parseDeviceAuth(SAMPLE.slice(0, SAMPLE.indexOf('\n', codeAt) + 1))).toEqual({ url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE });
  });

  test('words that are not the output: null', () => {
    expect(parseDeviceAuth('')).toBeNull();
    expect(parseDeviceAuth('Error: could not reach the sign-in service\n')).toBeNull();
    expect(parseDeviceAuth(`Open ${URL_IN_SAMPLE}\n`)).toBeNull();
    expect(parseDeviceAuth('ABCD-12345\n')).toBeNull();
    // A version number is not a code.
    expect(parseDeviceAuth(`${URL_IN_SAMPLE}\nv0.169.0\ncodex-cli\n`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------

const SPEC: LoginSpec = { cmd: ['setpriv', '--', 'codex', 'login', '--device-auth'], cwd: '/app', env: { CODEX_HOME: '/data/codex' } };

function setup(over: Partial<LoginDeps> = {}) {
  const codex = fakeCodex();
  const timers = fakeTimers();
  const order: string[] = [];
  const logs: string[] = [];
  const clock = { now: 5_000_000 };
  const signedIn: Check = { ok: true, detail: 'signed in with ChatGPT' };
  const login = new CodexLogin({
    spec: SPEC,
    spawn: codex.spawn,
    check: async () => { order.push('check'); return signedIn; },
    report: (check) => { order.push(`report ${check.detail}`); },
    refresh: async () => { order.push('refresh'); },
    backup: async () => { order.push('backup'); return { ok: true }; },
    log: (line) => { logs.push(line); },
    now: () => clock.now,
    timer: timers.timer,
    ...over,
  });
  return { login, codex, timers, order, logs, clock };
}

describe('the Codex sign-in in the container', () => {
  test('it starts the command as given and answers as soon as the address and code are known', async () => {
    const { login, codex, clock } = setup();
    expect(login.status()).toEqual({ state: 'idle' });
    const answer = login.start();
    expect(codex.runs.length).toBe(1);
    expect(codex.runs[0]!.spec).toEqual(SPEC);
    expect(login.status()).toEqual({ state: 'waiting', startedAt: clock.now });
    expect(login.waiting).toBe(true);

    // The output arrives in pieces, as a pipe gives it.
    let answered = false;
    void answer.then(() => { answered = true; });
    const cut = SAMPLE.indexOf(CODE_IN_SAMPLE) + 4;
    codex.runs[0]!.say(SAMPLE.slice(0, cut));
    await Promise.resolve();
    expect(answered).toBe(false);
    codex.runs[0]!.say(SAMPLE.slice(cut));
    const waiting: CodexLoginStatus = { state: 'waiting', url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE, startedAt: clock.now };
    expect(await answer).toEqual({ ok: true, codexLogin: waiting });
    expect(login.status()).toEqual(waiting);
    // The command still runs: the owner has the code to type.
    expect(codex.runs[0]!.signals).toEqual([]);
  });

  test('only one sign-in at a time: a second start answers with the same address and code', async () => {
    const { login, codex } = setup();
    const first = login.start();
    // A second call before the code is known waits for the same one.
    const second = login.start();
    codex.runs[0]!.say(SAMPLE);
    const a = await first;
    expect(await second).toEqual(a);
    // And one after it is known gets it at once.
    expect(await login.start()).toEqual(a);
    expect(a).toMatchObject({ ok: true, codexLogin: { url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE } });
    expect(codex.runs.length).toBe(1);
  });

  test('cancel stops the command; the status is idle and holds no code; a new sign-in can start', async () => {
    const { login, codex, order, clock } = setup();
    const first = login.start();
    codex.runs[0]!.say(SAMPLE);
    await first;
    clock.now += 30_000;
    const answer = await login.cancel();
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    expect(answer).toEqual({ ok: true, codexLogin: { state: 'idle', endedAt: clock.now, detail: 'cancelled' } });
    expect(login.status()).toEqual({ state: 'idle', endedAt: clock.now, detail: 'cancelled' });
    expect(login.waiting).toBe(false);
    // Nothing was checked or backed up: there is no new sign-in.
    await login.settled();
    expect(order).toEqual([]);

    const again = login.start();
    expect(codex.runs.length).toBe(2);
    codex.runs[1]!.say(SAMPLE.replace(CODE_IN_SAMPLE, 'WXYZ-98765'));
    expect(await again).toMatchObject({ ok: true, codexLogin: { state: 'waiting', code: 'WXYZ-98765' } });
  });

  test('cancel before the code is known answers the waiting start with a plain error', async () => {
    const { login } = setup();
    const first = login.start();
    await login.cancel();
    expect(await first).toEqual({ ok: false, error: LOGIN_MESSAGES.cancelled, codexLogin: login.status() });
  });

  test('cancel with nothing in hand changes nothing', async () => {
    const { login, codex } = setup();
    expect(await login.cancel()).toEqual({ ok: true, codexLogin: { state: 'idle' } });
    expect(codex.runs).toEqual([]);
  });

  test('no address and code in 20 s: the command is stopped and the start answers with an error', async () => {
    const { login, codex, timers, clock } = setup();
    const answer = login.start();
    expect(ANNOUNCE_MS).toBe(20_000);
    codex.runs[0]!.say('Welcome to Codex\nsk-invented-secret-0000 is not a thing to keep\n');
    clock.now += ANNOUNCE_MS;
    timers.fire(ANNOUNCE_MS);
    const failed: CodexLoginStatus = { state: 'failed', startedAt: clock.now - ANNOUNCE_MS, endedAt: clock.now, detail: 'codex printed no address and code in 20 s' };
    expect(await answer).toEqual({ ok: false, error: LOGIN_MESSAGES.noCode, codexLogin: failed });
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    expect(login.status()).toEqual(failed);
    expect(login.waiting).toBe(false);
    expect(timers.pending()).toEqual([]);
  });

  test('only an address on another host: it is never given to the owner, and the start fails after 20 s', async () => {
    const { login, codex, timers, clock } = setup();
    const answer = login.start();
    let answered = false;
    void answer.then(() => { answered = true; });
    codex.runs[0]!.say(SAMPLE.replace(URL_IN_SAMPLE, 'https://sign-in.example.com/codex/device'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The wait goes on: no address, no code.
    expect(answered).toBe(false);
    expect(login.status()).toEqual({ state: 'waiting', startedAt: clock.now });
    timers.fire(ANNOUNCE_MS);
    const failed = await answer;
    expect(failed).toMatchObject({ ok: false, error: LOGIN_MESSAGES.noCode, codexLogin: { state: 'failed', detail: 'codex printed no address and code in 20 s' } });
    expect(JSON.stringify(failed) + JSON.stringify(login.status())).not.toContain('example.com');
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
  });

  test('another address first, then the real one: the owner gets the real one', async () => {
    const { login, codex } = setup();
    const answer = login.start();
    codex.runs[0]!.say('Update available: https://updates.example.com/codex\n');
    codex.runs[0]!.say(SAMPLE);
    expect(await answer).toMatchObject({ ok: true, codexLogin: { state: 'waiting', url: URL_IN_SAMPLE, code: CODE_IN_SAMPLE } });
  });

  test('once the code is known, the 20 s limit no longer applies', async () => {
    const { login, codex, timers } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    timers.fire(ANNOUNCE_MS);
    expect(codex.runs[0]!.signals).toEqual([]);
    expect(login.status().state).toBe('waiting');
  });

  test('the command gets at most 15 minutes', async () => {
    const { login, codex, timers, clock, order } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    expect(LIMIT_MS).toBe(15 * 60_000);
    expect(timers.list.map((t) => t.ms)).toEqual([ANNOUNCE_MS, LIMIT_MS]);
    clock.now += LIMIT_MS;
    timers.fire(LIMIT_MS);
    await login.settled();
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    expect(login.status()).toEqual({ state: 'failed', startedAt: clock.now - LIMIT_MS, endedAt: clock.now, detail: 'the sign-in was not completed in 15 minutes' });
    expect(order).toEqual([]);
  });

  test('a sign-in that completes just as the 15-minute limit fires is done, not failed', async () => {
    const { login, codex, timers, order } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    // The limit fires and sends SIGTERM, but the command was already writing the sign-in: it exits 0.
    codex.runs[0]!.stubborn = true;
    timers.fire(LIMIT_MS);
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    codex.runs[0]!.exit(0);
    await login.settled();
    expect(login.status()).toMatchObject({ state: 'done', detail: 'signed in with ChatGPT' });
    expect(order).toEqual(['check', 'report signed in with ChatGPT', 'refresh', 'backup']);
  });

  test('the same for a cancel that arrives as the sign-in completes: exit 0 is a sign-in, and it is backed up', async () => {
    const { login, codex, order } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    codex.runs[0]!.stubborn = true;
    const cancelled = login.cancel();
    codex.runs[0]!.exit(0);
    expect(await cancelled).toMatchObject({ ok: true, codexLogin: { state: 'done' } });
    await login.settled();
    expect(order).toContain('backup');
  });

  test('a start while the result of an exited command is checked gets the status, never the used code, and starts nothing', async () => {
    let release: (check: Check) => void = () => {};
    const checking = new Promise<Check>((resolve) => { release = resolve; });
    const { login, codex, clock } = setup({ check: () => checking });
    const first = await (() => { const a = login.start(); codex.runs[0]!.say(SAMPLE); return a; })();
    expect(first).toMatchObject({ ok: true, codexLogin: { code: CODE_IN_SAMPLE } });

    codex.runs[0]!.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The check runs (it can take 20 s). The address and code are used: the status no longer holds them.
    expect(login.status()).toEqual({ state: 'waiting', startedAt: clock.now });
    expect(login.waiting).toBe(true);
    const second = await login.start();
    expect(second).toEqual({ ok: true, codexLogin: { state: 'waiting', startedAt: clock.now } });
    expect(JSON.stringify(second)).not.toContain(CODE_IN_SAMPLE);
    expect(codex.runs.length).toBe(1);
    // A cancel now stops nothing: the command is gone.
    const cancelled = login.cancel();
    release({ ok: true, detail: 'signed in with ChatGPT' });
    expect(await cancelled).toMatchObject({ ok: true, codexLogin: { state: 'done' } });
    expect(codex.runs[0]!.signals).toEqual([]);
    await login.settled();

    // After the check a start is a new sign-in.
    const third = login.start();
    expect(codex.runs.length).toBe(2);
    codex.runs[1]!.say(SAMPLE.replace(CODE_IN_SAMPLE, 'WXYZ-98765'));
    expect(await third).toMatchObject({ ok: true, codexLogin: { state: 'waiting', code: 'WXYZ-98765' } });
  });

  test('a command that ignores SIGTERM is killed after the grace period', async () => {
    const { login, codex, timers } = setup({ killGraceMs: 5_000 });
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    codex.runs[0]!.stubborn = true;
    const cancelled = login.cancel();
    await Promise.resolve();
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM']);
    expect(login.waiting).toBe(true);
    timers.fire(5_000);
    await cancelled;
    expect(codex.runs[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(login.status().state).toBe('idle');
  });

  test('a failure says an exit code or a fixed phrase, never what the program printed', async () => {
    const { login, codex, logs } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    // Words that could hold part of a secret, on the way out.
    codex.runs[0]!.say('Error: token exchange failed for refresh_token=rt-invented-secret-1234\n');
    codex.runs[0]!.exit(1);
    await login.settled();
    const s = login.status();
    expect(s).toMatchObject({ state: 'failed', detail: 'codex login exited 1' });
    expect(s.url).toBeUndefined();
    expect(s.code).toBeUndefined();
    const everything = JSON.stringify(s) + logs.join('\n');
    expect(everything).not.toContain('rt-invented-secret');
    expect(everything).not.toContain('token exchange');
    // The log never holds the one-time code either.
    expect(logs.join('\n')).not.toContain(CODE_IN_SAMPLE);

    // The same when it fails before any code: the start answers with a plain error.
    const early = setup();
    const second = early.login.start();
    early.codex.runs[0]!.say('error: sk-invented-secret-0000\n');
    early.codex.runs[0]!.exit(2);
    const failed = await second;
    expect(failed).toMatchObject({ ok: false, error: LOGIN_MESSAGES.noCode, codexLogin: { state: 'failed', detail: 'codex login exited 2' } });
    expect(JSON.stringify(failed) + early.logs.join('\n')).not.toContain('sk-invented');
  });

  test('a command that cannot be started: failed, with a fixed phrase', async () => {
    const { login } = setup({ spawn: () => { throw new Error('ENOENT: no such file, /secret/path/codex'); } });
    const answer = await login.start();
    expect(answer).toMatchObject({ ok: false, error: LOGIN_MESSAGES.notStarted, codexLogin: { state: 'failed', detail: 'codex could not be started' } });
    expect(JSON.stringify(answer)).not.toContain('/secret/path');
    expect(login.waiting).toBe(false);
  });

  test('exit 0: the sign-in check runs again, the status takes it, the readiness view is read again, then a backup', async () => {
    const { login, codex, order, clock, timers } = setup();
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    clock.now += 90_000;
    codex.runs[0]!.exit(0);
    await login.settled();
    expect(order).toEqual(['check', 'report signed in with ChatGPT', 'refresh', 'backup']);
    expect(login.status()).toEqual({ state: 'done', startedAt: clock.now - 90_000, endedAt: clock.now, detail: 'signed in with ChatGPT' });
    expect(login.waiting).toBe(false);
    expect(timers.pending()).toEqual([]);
    expect(codex.runs[0]!.signals).toEqual([]);
  });

  test('exit 0 but the check finds no sign-in: failed, reported, and no backup is forced', async () => {
    const { login, codex, order } = setup({ check: async () => ({ ok: false, detail: 'not signed in' }) });
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    codex.runs[0]!.exit(0);
    await login.settled();
    expect(login.status()).toMatchObject({ state: 'failed', detail: 'codex login exited 0, but the check says: not signed in' });
    expect(order).toEqual(['report not signed in', 'refresh']);
  });

  test('a backup that fails after a sign-in is logged; the sign-in is still done', async () => {
    const { login, codex, logs } = setup({ backup: async () => ({ ok: false, reason: 'the backup store answered 500' }) });
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    await answer;
    codex.runs[0]!.exit(0);
    await login.settled();
    expect(login.status().state).toBe('done');
    expect(logs.join('\n')).toContain('the backup of the new sign-in did not happen (the backup store answered 500)');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('a sign-in beside a real keeper', () => {
  const temps: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'keeper-login-test-'));
    temps.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const target = () => {
    const root = temp();
    return { layout: { db: join(root, 'data', 'egg.db'), codexHome: join(root, 'data', 'codex') } as Layout, work: join(root, 'work') };
  };
  const children: ChildSpec[] = [{ name: 'server', cmd: ['true'], cwd: '/', env: {} }];
  const spawnApp = (): Proc => {
    let exit: (code: number) => void = () => {};
    return { exited: new Promise<number>((resolve) => { exit = resolve; }), kill: () => exit(0) };
  };
  const selfTest = async (): Promise<SelfTest> => ({ at: 0, programs: {}, codexSignedIn: { ok: false, detail: 'not signed in' }, codexSandbox: { state: 'unknown', detail: 'test' } });

  test('after exit 0 the new sign-in is backed up at once, the status reports it, and a new container restores it', async () => {
    // A store with one backup whose sign-in has run out.
    const store = new FakeStore();
    const old = target();
    makeDb(old.layout.db);
    mkdirSync(old.layout.codexHome!, { recursive: true });
    writeFileSync(join(old.layout.codexHome!, 'auth.json'), '{"invented":"old sign-in"}');
    const seeded = await prepareBackup({ layout: old.layout, work: old.work, from: 'seed', last: null, allowShrink: false, now: Date.now() - 10_000 });
    if (seeded.kind !== 'ready') throw new Error(seeded.reason);
    await sendBackup(store, seeded.prepared);

    const t = target();
    const logs: string[] = [];
    // A long quiet period: the backup below is the one the sign-in asks for, not the one a change brings.
    const keeper = new Keeper({ store, ...t, allowEmpty: false, allowShrink: false, children, spawn: spawnApp, selfTest, log: (l) => logs.push(l), pollMs: 1_000_000, quietMs: 3_600_000, maxWaitMs: 3_600_000 });
    await keeper.start();
    await Promise.resolve();
    expect(keeper.status().selfTest!.codexSignedIn).toEqual({ ok: false, detail: 'not signed in' });
    store.events = [];

    const codex = fakeCodex();
    let refreshed = 0;
    const login = new CodexLogin({
      spec: SPEC,
      spawn: codex.spawn,
      check: async () => ({ ok: true, detail: 'signed in with ChatGPT' }),
      report: (check) => keeper.codexSignedIn(check),
      refresh: async () => { refreshed++; },
      backup: () => keeper.backup('signed in', true),
      log: (l) => logs.push(l),
      timer: fakeTimers().timer,
    });
    const answer = login.start();
    codex.runs[0]!.say(SAMPLE);
    expect(await answer).toMatchObject({ ok: true, codexLogin: { state: 'waiting', code: CODE_IN_SAMPLE } });
    expect(store.events).toEqual([]);

    // The owner typed the code: Codex writes the sign-in and exits 0.
    writeFileSync(join(t.layout.codexHome!, 'auth.json'), '{"invented":"new sign-in"}');
    codex.runs[0]!.exit(0);
    await login.settled();

    expect(login.status()).toMatchObject({ state: 'done', detail: 'signed in with ChatGPT' });
    expect(keeper.status().selfTest!.codexSignedIn).toEqual({ ok: true, detail: 'signed in with ChatGPT' });
    expect(refreshed).toBe(1);
    expect(store.events.map((e) => e.split(' ')[0])).toEqual(['upload', 'commit']);
    expect(keeper.status()).toMatchObject({ unsaved: false, lastBackupError: null });
    expect(logs.some((l) => l.includes('backed up (signed in)'))).toBe(true);
    await keeper.stop('SIGTERM');

    const next = target();
    const r = await restore({ store, ...next, allowEmpty: false, log: () => {}, sleep: async () => {} });
    expect(r.kind).toBe('restored');
    expect(readFileSync(join(next.layout.codexHome!, 'auth.json'), 'utf8')).toBe('{"invented":"new sign-in"}');
    expect(logs.join('\n')).not.toContain('new sign-in');
  });
});
