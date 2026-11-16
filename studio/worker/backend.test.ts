// Tests for the Durable Object's work (backend.ts) with a fake container, a fake keeper and a fake clock: the start,
// the wait for readiness, the forwarding, and the lifetime rules of the alarm. Run from studio/: `bun run test`.
import { describe, expect, test } from 'bun:test';
import { Backend, CHECK_MS, IDLE_MS, INACTIVITY_MS, MAX_BUSY_MS, type BackendDeps, type ContainerLike, type KeeperStatus } from './backend.ts';
import { MESSAGES } from './messages.ts';

const MINUTE = 60_000;

function fakeContainer() {
  const calls: string[] = [];
  let exit: () => void = () => {};
  const keeper: KeeperStatus & { reachable: boolean } = { reachable: true, phase: 'running', note: '', busy: false, unsaved: false, serverHealthy: true };
  const appRequests: { url: string; init: RequestInit }[] = [];
  const keeperRequests: { url: string; method: string; token: string | null }[] = [];
  const c = {
    calls, keeper, appRequests, keeperRequests,
    running: false,
    images: { base: 'registry/img@sha256:1' } as Record<string, string>,
    runningImage: 'registry/img@sha256:1',
    startOptions: null as null | { image: string; instance: string; enableInternet: boolean; env: Record<string, string> },
    start(options: { image: string; instance: string; enableInternet: boolean; env: Record<string, string> }) {
      if (c.running) throw new Error('already running');
      calls.push('start');
      c.running = true;
      c.startOptions = options;
      c.runningImage = options.image;
    },
    monitor: () => new Promise<void>((resolve) => { exit = resolve; }),
    signal(signo: number) {
      calls.push(`signal ${signo}`);
      c.running = false;
      exit();
    },
    async setInactivityTimeout(ms: number) { calls.push(`timeout ${ms}`); },
    async interceptOutboundHttp(addr: string) { calls.push(`intercept ${addr}`); },
    async inspect() { return c.running ? { image: c.runningImage } : null; },
    getTcpPort(port: number) {
      return {
        async fetch(input: string, init: RequestInit = {}) {
          if (port === 8788) {
            const token = new Headers(init.headers).get('x-egg-token');
            keeperRequests.push({ url: input, method: init.method ?? 'GET', token });
            if (!keeper.reachable) throw new Error('connection refused');
            if (input.endsWith('/backup')) {
              keeper.unsaved = false;
              return Response.json({ ok: true, key: 'backups/x.tar.gz' });
            }
            const { reachable: _r, ...status } = keeper;
            return Response.json(status);
          }
          appRequests.push({ url: input, init });
          return new Response(init.body ?? 'ok', { headers: { 'content-type': 'application/json' } });
        },
      };
    },
  };
  return c;
}

function fakeStorage() {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    map,
    get alarmAt() { return alarm; },
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async put(key: string, value: unknown) { map.set(key, value); },
    async getAlarm() { return alarm; },
    async setAlarm(at: number) { alarm = at; },
  };
}

function setup(env: BackendDeps['env'] = {}) {
  const clock = { now: 1_000_000_000_000 };
  const container = fakeContainer();
  const storage = fakeStorage();
  const logs: string[] = [];
  const gateways: string[] = [];
  const backend = new Backend({
    container: container as unknown as ContainerLike,
    storage,
    gateway: (token) => { gateways.push(token); return { token }; },
    env,
    log: (m) => logs.push(m),
    waitUntil: () => {},
    now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; },
  });
  return { backend, container, storage, clock, logs, gateways };
}

const api = (path: string, init: RequestInit = {}) => new Request(`http://studio${path}`, init);

describe('the container start', () => {
  test('the first request starts the container, with the intercept first, and is forwarded once the app answers', async () => {
    const { backend, container, gateways } = setup({ GH_TOKEN: 'gh-invented' });
    const res = await backend.forward(api('/jobs?x=1'));
    expect(res.status).toBe(200);
    expect(container.calls.slice(0, 3)).toEqual(['intercept backup.internal', 'start', `timeout ${INACTIVITY_MS}`]);
    const o = container.startOptions!;
    expect(o.image).toBe('registry/img@sha256:1');
    expect(o.instance).toBe('standard-1');
    expect(o.enableInternet).toBe(true);
    expect(o.env.EGG_BACKUP_URL).toBe('http://backup.internal');
    expect(o.env.EGG_BACKUP_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(gateways).toEqual([o.env.EGG_BACKUP_TOKEN!]);
    expect(o.env.GH_TOKEN).toBe('gh-invented');
    expect(container.appRequests[0]!.url).toBe('http://app/jobs?x=1');
    expect(container.keeperRequests[0]!.token).toBe(o.env.EGG_BACKUP_TOKEN!);
  });

  test('settings that are not set are not passed', async () => {
    const { backend, container } = setup({});
    await backend.forward(api('/bank'));
    expect(Object.keys(container.startOptions!.env).sort()).toEqual(['EGG_BACKUP_TOKEN', 'EGG_BACKUP_URL']);
  });

  test('a request waits while the keeper restores, then goes through', async () => {
    const { backend, container, clock } = setup();
    container.keeper.phase = 'restoring';
    const t0 = clock.now;
    const waiting = backend.forward(api('/bank'));
    // The fake sleep moves the clock; after a few rounds the keeper is running.
    let rounds = 0;
    const orig = container.getTcpPort.bind(container);
    container.getTcpPort = (port: number) => {
      if (port === 8788 && ++rounds === 4) container.keeper.phase = 'running';
      return orig(port);
    };
    const res = await waiting;
    expect(res.status).toBe(200);
    expect(clock.now - t0).toBeLessThan(60_000);
  });

  test('still not ready after about 60 s: 503 with the starting message and retry-after', async () => {
    const { backend, container } = setup();
    container.keeper.reachable = false;
    const res = await backend.forward(api('/bank'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ error: "The studio's server is starting. Try again in a moment." });
    expect(container.appRequests).toEqual([]);
  });

  test('a keeper that refused to start the app: 503 that says why, at once', async () => {
    const { backend, container, clock } = setup();
    container.keeper.phase = 'failed';
    container.keeper.note = 'the store holds no backup yet.';
    const t0 = clock.now;
    const res = await backend.forward(api('/bank'));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(`${MESSAGES.containerFailed} the store holds no backup yet.`);
    expect(clock.now - t0).toBeLessThan(5_000);
  });

  test('requests that arrive together share one start', async () => {
    const { backend, container } = setup();
    await Promise.all([backend.forward(api('/a')), backend.forward(api('/b')), backend.forward(api('/c'))]);
    expect(container.calls.filter((c) => c === 'start').length).toBe(1);
    expect(container.appRequests.length).toBe(3);
  });

  test('an upload body is passed on as a stream', async () => {
    const { backend, container } = setup();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(2048)); c.close(); } });
    const res = await backend.forward(api('/sources/upload', { method: 'POST', body, duplex: 'half' } as RequestInit));
    expect(container.appRequests[0]!.init.body).toBeInstanceOf(ReadableStream);
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });

  test('the status never starts the container', async () => {
    const { backend, container } = setup();
    const res = await backend.status();
    const body = (await res.json()) as { backend: string; container: { running: boolean }; keeper: unknown };
    expect(body).toMatchObject({ backend: 'container', container: { running: false }, keeper: null });
    expect(container.calls).toEqual([]);
  });

  test('a backup asked for while the container sleeps: 409, nothing started', async () => {
    const { backend, container } = setup();
    const res = await backend.backupNow();
    expect(res.status).toBe(409);
    expect(container.calls).toEqual([]);
  });
});

describe('the lifetime rules (the alarm)', () => {
  async function running() {
    const s = setup();
    await s.backend.forward(api('/bank'));
    s.container.calls.length = 0;
    return s;
  }

  test('quiet for 20 minutes, nothing in hand: ask for a backup, then SIGTERM', async () => {
    const { backend, container, clock } = await running();
    clock.now += IDLE_MS + 1;
    await backend.alarm();
    expect(container.keeperRequests.filter((r) => r.method === 'POST').map((r) => r.url)).toEqual(['http://keeper/backup']);
    expect(container.calls.at(-1)).toBe('signal 15');
    expect(container.running).toBe(false);
  });

  test('unsaved changes keep the container running until the keeper has saved them', async () => {
    const { backend, container, clock } = await running();
    container.keeper.unsaved = true;
    clock.now += IDLE_MS + 1;
    await backend.alarm();
    expect(container.calls).not.toContain('signal 15');
    container.keeper.unsaved = false;
    clock.now += CHECK_MS;
    await backend.alarm();
    expect(container.calls).toContain('signal 15');
  });

  test('stopped at the longest wait with unsaved changes: back up first, then SIGTERM', async () => {
    const { backend, container, clock } = await running();
    container.keeper.unsaved = true;
    clock.now += MAX_BUSY_MS + 1;
    await backend.alarm();
    expect(container.keeperRequests.filter((r) => r.method === 'POST').map((r) => r.url)).toEqual(['http://keeper/backup']);
    expect(container.calls.at(-1)).toBe('signal 15');
  });

  test('work in hand keeps the container running, and the timeout is set again', async () => {
    const { backend, container, clock, storage } = await running();
    container.keeper.busy = true;
    clock.now += IDLE_MS + 1;
    await backend.alarm();
    expect(container.calls).toEqual([`timeout ${INACTIVITY_MS}`]);
    expect(storage.alarmAt).toBe(clock.now + CHECK_MS);
  });

  test('a recent request keeps the container running', async () => {
    const { backend, container, clock } = await running();
    clock.now += 5 * MINUTE;
    await backend.alarm();
    expect(container.calls).not.toContain('signal 15');
  });

  test('work that never ends does not keep it up for ever', async () => {
    const { backend, container, clock } = await running();
    container.keeper.busy = true;
    clock.now += MAX_BUSY_MS + 1;
    await backend.alarm();
    expect(container.calls).toContain('signal 15');
  });

  test('a newer image restarts the container once nothing is in hand', async () => {
    const { backend, container, clock } = await running();
    container.images.base = 'registry/img@sha256:2';
    clock.now += 3 * MINUTE;
    await backend.alarm();
    expect(container.calls).toContain('signal 15');
    // The next request starts it on the new image.
    await backend.forward(api('/bank'));
    expect(container.startOptions!.image).toBe('registry/img@sha256:2');
  });

  test('an image reference that never matches does not restart the container again and again', async () => {
    const { backend, container, clock } = await running();
    container.images.base = 'registry/img@sha256:2';
    clock.now += 3 * MINUTE;
    await backend.alarm();
    await backend.forward(api('/bank'));
    container.runningImage = 'written-another-way';
    container.calls.length = 0;
    clock.now += 3 * MINUTE;
    await backend.alarm();
    expect(container.calls).not.toContain('signal 15');
  });

  test('the daily alarm starts a sleeping container so the job boards are checked, and comes back a day later', async () => {
    const { backend, container, clock, storage } = setup();
    await backend.status(); // Nothing armed yet.
    await backend.forward(api('/bank'));
    container.signal(15);
    container.calls.length = 0;
    const daily = storage.map.get('nextDailyAt') as number;
    clock.now = daily + 1;
    await backend.alarm();
    expect(container.calls).toContain('start');
    expect(storage.map.get('nextDailyAt')).toBe(clock.now + 24 * 60 * MINUTE);
    // Soon after, a check; not stopped while the wake is recent.
    expect(storage.alarmAt).toBe(clock.now + CHECK_MS);
  });

  test('a stopped container: the alarm only waits for the next daily wake', async () => {
    const { backend, container, storage } = setup();
    await backend.alarm();
    expect(container.calls).toEqual([]);
    expect(storage.alarmAt).toBe(storage.map.get('nextDailyAt') as number);
  });
});
