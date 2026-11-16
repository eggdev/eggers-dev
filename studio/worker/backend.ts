// The Durable Object's work, without Cloudflare imports so `bun test` runs it with a fake container: it owns the one
// container (the Durable Object is named "studio"), starts it, waits until it is ready, forwards API requests to the
// app's server in it, and decides when it may sleep. studio/worker/index.ts is the thin Durable Object class.
//
// The container (cloud/Dockerfile) runs the keeper (cloud/keeper.ts), which restores the data from the bucket,
// runs server.ts and worker.ts, and backs the data up. The Durable Object reaches:
//   the app's server   port 8787, every /api/... request (the Worker has stripped /api)
//   the keeper         port 8788, with this start's token: GET /status, POST /backup, and POST /codex/login and
//                      /codex/cancel (the Codex sign-in that runs in the container, cloud/lib/codexlogin.ts)
// and gives the container one outbound route: http://backup.internal, to the backup gateway (backups.ts).
//
// Lifetime. Containers stop a container some time after its Durable Object goes quiet (setInactivityTimeout). An
// alarm wakes the Durable Object every few minutes while the container runs. The container keeps running while API
// requests arrive, or while the keeper reports work in hand (a source being read, a resume being written, a Codex
// sign-in that waits for the owner) or changes not yet backed up. After IDLE_MS with none of these, the Durable
// Object asks the keeper for a last backup and sends SIGTERM; the keeper stops the app, backs up anything left and
// exits. Once a day the alarm starts the container, so the worker's daily job-board check runs; then the same idle
// rule lets it sleep again.
import { MESSAGES } from './messages.ts';

export const APP_PORT = 8787;
export const KEEPER_PORT = 8788;
export const BACKUP_HOST = 'backup.internal';
export const INSTANCE = 'standard-1';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long an API request waits for a container that is starting. */
export const READY_WAIT_MS = 60 * SECOND;
/** How long the platform keeps the container after the Durable Object goes quiet. The alarm comes sooner. */
export const INACTIVITY_MS = 30 * MINUTE;
/** Quiet time (no request, no work, nothing unsaved) after which the container is stopped. */
export const IDLE_MS = 20 * MINUTE;
/** How often the alarm looks at a running container. */
export const CHECK_MS = 5 * MINUTE;
/** Work in hand keeps the container running this long after the last request at most, so a stuck queue cannot keep it up for ever. */
export const MAX_BUSY_MS = 6 * HOUR;
/** The time a stopping keeper is given for its last backup before the Durable Object stops waiting for it. */
export const BACKUP_WAIT_MS = 5 * MINUTE;
/** How long the keeper has to answer a sign-in start. It answers when Codex has printed the address and code, or gives up after about 20 s. */
export const LOGIN_WAIT_MS = 40 * SECOND;
/** How long the keeper has to stop a sign-in. */
export const CANCEL_WAIT_MS = 15 * SECOND;
const SIGTERM = 15;

type Fetchish = { fetch(input: string, init?: RequestInit): Promise<Response> };

/** The parts of ctx.container this file uses (the Durable Object Container API). */
export interface ContainerLike {
  readonly running: boolean;
  readonly images: Record<string, string>;
  start(options: { image: string; instance: string; enableInternet: boolean; env: Record<string, string> }): void;
  monitor(): Promise<void>;
  signal(signo: number): void;
  getTcpPort(port: number): Fetchish;
  setInactivityTimeout(durationMs: number): Promise<void>;
  interceptOutboundHttp(addr: string, binding: unknown): Promise<void>;
  inspect(): Promise<{ image: string } | null>;
}

/** The parts of ctx.storage this file uses. */
export interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}

/** Worker settings passed on to the container when they are set. */
export const PASSED_ENV = ['GH_TOKEN', 'EGG_ALLOW_EMPTY', 'EGG_ALLOW_SHRINK', 'EGG_CODEX_OPUS', 'EGG_CODEX_SONNET', 'EGG_CODEX_HAIKU', 'EGG_QUIET_MS', 'EGG_MAX_WAIT_MS'] as const;

export type BackendDeps = {
  container: ContainerLike;
  storage: StorageLike;
  /** The outbound handler for http://backup.internal, bound to this start's token. */
  gateway: (token: string) => unknown;
  env: Partial<Record<(typeof PASSED_ENV)[number], string>>;
  log: (msg: string) => void;
  waitUntil: (p: Promise<unknown>) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  token?: () => string;
};

/** What the keeper's GET /status answers (cloud/lib/keeper.ts, KeeperStatus), as far as this file reads it. */
export type KeeperStatus = {
  phase: 'restoring' | 'running' | 'stopping' | 'stopped' | 'failed';
  note: string;
  busy: boolean;
  unsaved: boolean;
  serverHealthy?: boolean;
  [more: string]: unknown;
};

const ALWAYS = { 'cache-control': 'no-store' } as const;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...ALWAYS, ...extra } });

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Backend {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private starting: Promise<void> | null = null;
  private ready = false;
  private token: string | null = null;
  private lastActivity = 0;
  private lastPersisted = 0;

  constructor(private readonly d: BackendDeps) {
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Called once when the Durable Object starts: a container that is already running gets its timeout and watch again. */
  async init(): Promise<void> {
    this.token = (await this.d.storage.get<string>('token')) ?? null;
    this.lastActivity = (await this.d.storage.get<number>('lastActivity')) ?? 0;
    if (this.d.container.running) {
      await this.d.container.setInactivityTimeout(INACTIVITY_MS).catch(() => {});
      this.watchExit();
    }
  }

  private watchExit() {
    this.d.waitUntil(
      this.d.container.monitor().then(
        () => this.d.log('container: exited'),
        (error) => this.d.log(`container: stopped (${error instanceof Error ? error.message : String(error)})`),
      ).finally(() => { this.ready = false; }),
    );
  }

  private async touch() {
    this.lastActivity = this.now();
    // Kept in storage now and then, so a restarted Durable Object still knows when the studio was last used.
    if (this.now() - this.lastPersisted > MINUTE) {
      this.lastPersisted = this.now();
      await this.d.storage.put('lastActivity', this.lastActivity);
    }
  }

  /** Starts the container when it is not running. Concurrent callers share one start. */
  private startContainer(): Promise<void> {
    if (this.d.container.running) return Promise.resolve();
    this.starting ??= (async () => {
      const c = this.d.container;
      const token = randomToken();
      this.token = this.d.token?.() ?? token;
      await this.d.storage.put('token', this.token);
      // The intercept goes in before the start, so the keeper's first request already reaches the gateway.
      await c.interceptOutboundHttp(BACKUP_HOST, this.d.gateway(this.token));
      const env: Record<string, string> = { EGG_BACKUP_TOKEN: this.token, EGG_BACKUP_URL: `http://${BACKUP_HOST}` };
      for (const name of PASSED_ENV) {
        const value = this.d.env[name];
        if (value) env[name] = value;
      }
      const image = c.images.base;
      if (!image) throw new Error('the container image "base" is not configured');
      c.start({ image, instance: INSTANCE, enableInternet: true, env });
      this.ready = false;
      this.d.log('container: started');
      await c.setInactivityTimeout(INACTIVITY_MS);
      this.watchExit();
      await this.armAlarm(this.now() + CHECK_MS);
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  /** The keeper's status, or null when it does not answer (not started yet, or stopped). */
  async keeperStatus(timeoutMs = 3 * SECOND): Promise<KeeperStatus | null> {
    if (!this.d.container.running || !this.token) return null;
    try {
      const res = await this.d.container.getTcpPort(KEEPER_PORT).fetch('http://keeper/status', {
        headers: { 'x-egg-token': this.token },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return (await res.json()) as KeeperStatus;
    } catch {
      return null;
    }
  }

  /** Waits until the app answers, starting the container when needed. */
  async ensureReady(waitMs = READY_WAIT_MS): Promise<{ ok: true } | { ok: false; failed?: string }> {
    if (this.ready && this.d.container.running) return { ok: true };
    const deadline = this.now() + waitMs;
    let pause = 250;
    while (this.now() < deadline) {
      if (!this.d.container.running) {
        try {
          await this.startContainer();
        } catch (error) {
          // "A container can be temporarily unavailable after signal() or destroy(). Retry allocation."
          this.d.log(`container: start failed (${error instanceof Error ? error.message : String(error)}); trying again`);
        }
      } else {
        const s = await this.keeperStatus();
        if (s?.phase === 'running' && s.serverHealthy) {
          this.ready = true;
          return { ok: true };
        }
        if (s?.phase === 'failed') return { ok: false, failed: s.note };
      }
      await this.sleep(pause);
      pause = Math.min(pause * 2, 2 * SECOND);
    }
    return { ok: false };
  }

  /** Counts as use, then waits for the app. The answer for the caller when the app is not ready, else null. */
  private async wake(): Promise<Response | null> {
    await this.touch();
    await this.armAlarm(this.now() + CHECK_MS);
    const ready = await this.ensureReady();
    if (ready.ok) return null;
    if (ready.failed) return json({ error: `${MESSAGES.containerFailed} ${ready.failed}` }, 503, { 'retry-after': '60' });
    return json({ error: MESSAGES.starting }, 503, { 'retry-after': '5' });
  }

  /** One API request: /<path>?<query> for the app's server, its body streamed both ways. */
  async forward(request: Request): Promise<Response> {
    const notReady = await this.wake();
    if (notReady) return notReady;
    const url = new URL(request.url);
    const init = {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      duplex: 'half',
      redirect: 'manual',
    } as RequestInit;
    try {
      const res = await this.d.container.getTcpPort(APP_PORT).fetch(`http://app${url.pathname}${url.search}`, init);
      await this.touch();
      return res;
    } catch (error) {
      this.ready = false;
      this.d.log(`container: the server did not answer (${error instanceof Error ? error.message : 'unknown error'})`);
      return json({ error: MESSAGES.containerDown }, 502);
    }
  }

  /** GET /_studio/status: the keeper's status and the container's state, for the owner. Never starts the container. */
  async status(): Promise<Response> {
    const c = this.d.container;
    const info = c.running ? await c.inspect().catch(() => null) : null;
    return json({
      backend: 'container',
      container: {
        running: c.running,
        ready: this.ready && c.running,
        imageCurrent: info ? info.image === '' || info.image === c.images.base : null,
      },
      lastActivityAt: this.lastActivity || null,
      nextAlarmAt: await this.d.storage.getAlarm(),
      nextDailyWakeAt: (await this.d.storage.get<number>('nextDailyAt')) ?? null,
      keeper: await this.keeperStatus(),
    });
  }

  /** POST /_studio/backup: asks the keeper to back up now, and waits for it. */
  async backupNow(): Promise<Response> {
    if (!this.d.container.running || !this.token) return json({ error: MESSAGES.notRunning }, 409);
    await this.touch();
    return this.askKeeper('/backup', BACKUP_WAIT_MS);
  }

  /**
   * POST /_studio/codex/login: asks the keeper to start a Codex sign-in, and returns its JSON: the address and the
   * one-time code the owner types there. A sleeping container is started first, as for an API request.
   */
  async codexLogin(): Promise<Response> {
    const notReady = await this.wake();
    if (notReady) return notReady;
    return this.askKeeper('/codex/login', LOGIN_WAIT_MS);
  }

  /** POST /_studio/codex/cancel: asks the keeper to stop a sign-in that waits. Never starts the container. */
  async codexCancel(): Promise<Response> {
    // No container, no sign-in: the answer has the keeper's form.
    if (!this.d.container.running || !this.token) return json({ ok: true, codexLogin: { state: 'idle' } });
    return this.askKeeper('/codex/cancel', CANCEL_WAIT_MS);
  }

  /** One POST to the keeper's control endpoint with this start's token. Its JSON and status go back as they are. */
  private async askKeeper(path: string, timeoutMs: number): Promise<Response> {
    try {
      const res = await this.d.container.getTcpPort(KEEPER_PORT).fetch(`http://keeper${path}`, {
        method: 'POST',
        headers: { 'x-egg-token': this.token ?? '' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return json(await res.json(), res.status);
    } catch (error) {
      return json({ error: `The keeper did not answer (${error instanceof Error ? error.message : 'unknown error'}).` }, 502);
    }
  }

  private async armAlarm(at: number) {
    const daily = await this.nextDaily();
    const when = Math.min(at, daily);
    const current = await this.d.storage.getAlarm();
    if (current === null || current > when || current < this.now()) await this.d.storage.setAlarm(when);
  }

  private async nextDaily(): Promise<number> {
    let daily = await this.d.storage.get<number>('nextDailyAt');
    if (daily === undefined) {
      daily = this.now() + DAY;
      await this.d.storage.put('nextDailyAt', daily);
    }
    return daily;
  }

  /** The alarm: the daily wake, and the lifetime rule for a running container. */
  async alarm(): Promise<void> {
    const now = this.now();
    let daily = await this.nextDaily();
    if (now >= daily) {
      daily = now + DAY;
      await this.d.storage.put('nextDailyAt', daily);
      this.d.log('alarm: the daily wake, so the worker checks the job boards');
      // The wake counts as use, so the idle rule gives the worker time to start its check.
      await this.touch();
      if (!this.d.container.running) await this.startContainer().catch((e) => this.d.log(`alarm: start failed (${(e as Error).message})`));
    }

    if (!this.d.container.running) {
      await this.d.storage.setAlarm(daily);
      return;
    }

    const s = await this.keeperStatus();
    const quietFor = now - this.lastActivity;
    const info = await this.d.container.inspect().catch(() => null);
    const configured = this.d.container.images.base ?? '';
    // A restart for a new image happens once per configured image: if the running container still reports another
    // reference afterwards (the two may be written differently), it is not restarted again and again.
    const outdated = !!info && info.image !== '' && info.image !== configured && (await this.d.storage.get<string>('restartedFor')) !== configured;
    const working = !!s && (s.busy || s.unsaved || s.phase === 'restoring');
    let stop = false;
    if (s?.phase === 'stopping' || s?.phase === 'stopped') stop = false;
    else if (quietFor >= IDLE_MS && !working) stop = true;
    else if (quietFor >= MAX_BUSY_MS) {
      this.d.log(`alarm: the keeper has reported work for ${Math.round(quietFor / HOUR)} hours with no request; stopping the container anyway`);
      stop = true;
    } else if (outdated && !s?.busy && quietFor >= 2 * MINUTE) {
      this.d.log('alarm: a new image is deployed; restarting the container on it while nothing is in hand');
      await this.d.storage.put('restartedFor', configured);
      stop = true;
    }

    if (stop) {
      // A backup first (it saves nothing when nothing changed). The keeper backs up again as it stops, for
      // anything that changes in between.
      if (s?.phase === 'running') {
        const r = await this.backupNow();
        this.d.log(`alarm: the backup before sleep answered ${r.status}`);
      }
      this.ready = false;
      this.d.log('alarm: the studio is quiet; stopping the container (SIGTERM)');
      this.d.container.signal(SIGTERM);
      await this.d.storage.setAlarm(Math.min(now + CHECK_MS, daily));
      return;
    }
    await this.d.container.setInactivityTimeout(INACTIVITY_MS).catch(() => {});
    await this.d.storage.setAlarm(Math.min(now + CHECK_MS, daily));
  }
}
