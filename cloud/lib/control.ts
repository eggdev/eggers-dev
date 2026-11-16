// The keeper's control endpoint and its shutdown, without a server or a real process, so the tests can call them.
// cloud/keeper.ts serves fetch() on KEEPER_PORT (8788) for the Durable Object that owns the container, and calls
// shutdown() on SIGTERM or SIGINT.
//
//   GET  /status         the keeper's state as JSON: no data and no secrets. While a Codex sign-in waits, its
//                        `codexLogin` holds the address and the one-time code the owner types there, and `busy` is
//                        true, so the Durable Object does not stop the container under the sign-in.
//   POST /backup         back up now and wait for it
//   POST /codex/login    start a Codex sign-in in the container (codexlogin.ts); the answer has the address and the
//                        code. A second call while one waits answers with the same two. Refused with 409 unless
//                        the app runs, and from the moment the keeper is told to stop.
//   POST /codex/cancel   stop a sign-in that waits
// All need the start's token (header x-egg-token). Nothing else is served.
//
// This file also joins the sign-in to the keeper: after a sign-in, the keeper's status takes the new answer of the
// sign-in check, and the keeper backs up at once, changed data or not.
import { CodexLogin, type LoginDeps } from './codexlogin.ts';
import type { Keeper } from './keeper.ts';

export type ControlDeps = {
  /** This start's token. A request without it is refused; an empty token refuses everything. */
  token: string;
  keeper: Keeper;
  /** The sign-in's command and helpers. What it reports to and how it backs up are set here, from the keeper. */
  login: Omit<LoginDeps, 'report' | 'backup'>;
  /** Whether the app's server answers its health check. */
  serverHealthy: () => Promise<boolean>;
  /** The app's readiness view, as last read, or null. */
  llm: () => { ok: boolean; detail: string } | null;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export const NOT_RUNNING = 'The studio is not running, so Codex cannot be signed in now. Try again in a moment.';

export class Control {
  readonly login: CodexLogin;
  private stopped: Promise<number> | null = null;

  constructor(private readonly d: ControlDeps) {
    this.login = new CodexLogin({
      ...d.login,
      report: (check) => d.keeper.codexSignedIn(check),
      backup: () => d.keeper.backup('signed in', true),
    });
  }

  /** Whether the keeper was told to stop. */
  get stopping(): boolean {
    return this.stopped !== null;
  }

  /** One request to the control endpoint. */
  async fetch(request: Request): Promise<Response> {
    if (!this.d.token || request.headers.get('x-egg-token') !== this.d.token) return json({ error: 'forbidden' }, 403);
    const { keeper } = this.d;
    const { pathname } = new URL(request.url);
    if (pathname === '/status' && request.method === 'GET') {
      const s = keeper.status();
      // A sign-in that waits for the owner is work in hand: the Durable Object does not stop the container under it.
      return json({ ...s, busy: s.busy || this.login.waiting, serverHealthy: s.phase === 'running' ? await this.d.serverHealthy() : false, llm: this.d.llm(), codexLogin: this.login.status() });
    }
    if (pathname === '/backup' && request.method === 'POST') {
      const r = await keeper.backup('asked');
      return json(r, r.ok ? 200 : 409);
    }
    if (pathname === '/codex/login' && request.method === 'POST') {
      // Only beside a running app: the restore has put the Codex home in place, and a backup can be taken after.
      // Never once the keeper stops: shutdown() cancels the sign-in while the phase still says "running", and a
      // sign-in started then would be a process nothing stops.
      if (this.stopping || keeper.status().phase !== 'running') return json({ ok: false, error: NOT_RUNNING, codexLogin: this.login.status() }, 409);
      const r = await this.login.start();
      return json(r, r.ok ? 200 : 502);
    }
    if (pathname === '/codex/cancel' && request.method === 'POST') return json(await this.login.cancel());
    return json({ error: 'not found' }, 404);
  }

  /**
   * SIGTERM or SIGINT: a sign-in that waits is stopped first; then the app, then the last backup (Keeper.stop).
   * Resolves with the exit code. A second call gets the same promise: the keeper stops once.
   */
  shutdown(signal: string): Promise<number> {
    this.stopped ??= this.login.cancel().then(() => {}, () => {}).then(() => this.d.keeper.stop(signal));
    return this.stopped;
  }
}
