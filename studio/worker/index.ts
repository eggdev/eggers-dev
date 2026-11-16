// The Cloudflare Worker for the private studio: the Access check on every request, then /api/... to the app's
// server and every other path from the built screens in dist/ (studio.ts, access.ts). This file holds the parts
// that need the Workers runtime; the logic is in files `bun test` runs with fakes:
//   StudioContainer  the Durable Object that owns the one container (backend.ts)
//   BackupGateway    the outbound handler the container reaches at http://backup.internal (backups.ts)
//
// The gate is made once per isolate, so the Access keys it fetches stay in module memory between requests.
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { createGate } from './access.ts';
import { Backend, PASSED_ENV, type BackendDeps, type ContainerLike } from './backend.ts';
import { handleBackup, type Bucket } from './backups.ts';
import { MESSAGES } from './messages.ts';
import { worker, type Env as WorkerEnv } from './studio.ts';

type Env = WorkerEnv & Partial<Record<(typeof PASSED_ENV)[number], string>> & { DATA: Bucket };

export default worker({
  gate: createGate({ fetch: (url) => fetch(url) }),
  log: (msg) => console.log(msg),
});

/** The backup gateway. Its props carry the token of the container start that it serves. */
export class BackupGateway extends WorkerEntrypoint<Env, { token: string }> {
  fetch(request: Request): Promise<Response> {
    return handleBackup(request, { bucket: this.env.DATA, token: this.ctx.props?.token ?? '', now: () => Date.now(), log: (m) => console.log(m) });
  }
}

/** The Durable Object named "studio": the container's owner. */
export class StudioContainer extends DurableObject<Env> {
  private readonly backend: Backend | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container as unknown as ContainerLike | undefined;
    if (!container) {
      this.backend = null;
      return;
    }
    const passed: BackendDeps['env'] = {};
    for (const name of PASSED_ENV) passed[name] = env[name];
    const exports = ctx.exports as unknown as { BackupGateway(opts: { props: { token: string } }): Fetcher };
    const backend = new Backend({
      container,
      storage: ctx.storage,
      gateway: (token) => exports.BackupGateway({ props: { token } }),
      env: passed,
      log: (m) => console.log(m),
      waitUntil: (p) => ctx.waitUntil(p),
    });
    this.backend = backend;
    // "Set it again in the constructor when the container is already running."
    void ctx.blockConcurrencyWhile(() => backend.init());
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.backend) return Response.json({ error: MESSAGES.containerDown }, { status: 502 });
    const { pathname } = new URL(request.url);
    if (pathname === '/_studio/status' && request.method === 'GET') return this.backend.status();
    if (pathname === '/_studio/backup' && request.method === 'POST') return this.backend.backupNow();
    if (pathname.startsWith('/_studio')) return Response.json({ error: MESSAGES.notFound }, { status: 404 });
    return this.backend.forward(request);
  }

  async alarm(): Promise<void> {
    await this.backend?.alarm();
  }
}
