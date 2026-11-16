// The studio's Worker: the Access check on every request (access.ts), then /api/... to the app's server, and every
// other path from the built screens in dist/.
// This file has no Cloudflare imports, so `bun test` runs it with fake bindings.
//
// The API. The screens are built with API_BASE_URL=https://studio.eggers.dev/api, so the page calls
// /api/<path> on its own origin. The Worker strips /api and sends the request to the Durable Object STUDIO, which
// runs the server in a Cloudflare Container and backs its data up to R2 (backend.ts, cloud/keeper.ts). The
// container is the only backend: nothing runs on anyone's own machine.
// The page's paths (/profile, /jobs, /talk) are also API paths; the prefix keeps them apart.
// /api/_studio/... is the Worker's own, and the _studio segment is never forwarded to the server:
//   GET  /api/_studio/status         the container and its backups
//   POST /api/_studio/backup         back up now
//   POST /api/_studio/codex/login    start a Codex sign-in in the container; the answer has the address and code
//   POST /api/_studio/codex/cancel   stop a sign-in that waits
//   GET  /api/_studio/public         what the public website's chat answers from now (publish.ts)
//   POST /api/_studio/publish        publish the saved public collection
//   POST /api/_studio/unpublish      take it down
//
// The pages. Every route of the app is drawn in the browser (render=client), so a page such as /jobs or /job/12 has
// no file of its own. The Worker serves them by the rule Exact's own static host applies (`bun exact.mjs serve`,
// and the notes `web-build --out` prints): the file at the path; else, for a browser's navigation to a path that a
// route in routes.json matches, shell.html with status 200; else 404.html with status 404 when the build has one;
// else, for a navigation to a page path, shell.html with status 404 (the app then draws its notfound route); else an
// empty 404. Paths with a dot segment (.exact-build.json, .exact/) are never served.
import { readConfig, type Gate } from './access.ts';
import { MESSAGES } from './messages.ts';
import { live, publish, unpublish, type ContentBucket } from './publish.ts';

export { MESSAGES };

/** The Workers static assets binding, a plain file lookup here (wrangler.jsonc: html_handling "none"). */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

/** The Durable Object namespace STUDIO: one object, named "studio", owns the container. */
export interface StudioNamespace {
  getByName(name: string): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  ASSETS: Assets;
  STUDIO?: StudioNamespace;
  /** The R2 bucket the public website reads its collection from (publish.ts). It holds collection.md only. */
  CONTENT?: ContentBucket;
  /** The private R2 bucket: the backups, and the history copies of what was published (publish.ts). */
  DATA?: ContentBucket;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** The name of the one Durable Object that owns the container. */
export const STUDIO_OBJECT = 'studio';
// The address the Durable Object is called with. Only the path and query matter.
export const STUDIO_ORIGIN = 'http://studio';

export type Deps = {
  gate: Gate;
  /** Where operator messages go (Worker logs). Never a token, never the caller. */
  log: (msg: string) => void;
  now?: () => number;
};

// Headers on every response: the studio is private, so it is never indexed and never sends a referrer.
const ALWAYS = {
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...ALWAYS, ...extra } });

// ---------------------------------------------------------------------------------------------------------------
// The API

// Request headers the server reads. Nothing else goes: no cookie, no cf-* header, no Access token.
const FORWARD_REQUEST = ['content-type', 'accept'];
// Response headers the page needs. The server's CORS headers stay behind: the page is on the same origin now.
// retry-after goes too: the Durable Object sets it on its 503 while the container starts.
const FORWARD_RESPONSE = ['content-type', 'content-disposition', 'content-length', 'retry-after'];

/** Forwards /api/<path>?<query> to the server as /<path>?<query>, its body streamed both ways. */
export async function api(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/api'.length) || '/';
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const init = {
    method: request.method,
    headers,
    // The body is passed on as a stream, so an upload is never held whole in the Worker.
    body: hasBody ? request.body : undefined,
    duplex: 'half',
    redirect: 'manual',
  } as RequestInit;

  let upstream: Response;
  try {
    upstream = await studioObject(env).fetch(new Request(`${STUDIO_ORIGIN}${path}${url.search}`, init));
  } catch (error) {
    deps.log(`container: no answer (${error instanceof Error ? error.message : 'unknown error'})`);
    return jsonError(502, MESSAGES.containerDown);
  }

  const out = new Headers({ 'cache-control': 'no-store', ...ALWAYS });
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** The one Durable Object that owns the container. */
function studioObject(env: Env) {
  if (!env.STUDIO) throw new Error('the STUDIO binding is missing');
  return env.STUDIO.getByName(STUDIO_OBJECT);
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...ALWAYS } });
}

/** An answer of the Worker's own controls, with the studio's headers. A HEAD gets no body. */
function controlAnswer(res: Response, head: boolean): Response {
  const out = new Headers({ 'cache-control': 'no-store', ...ALWAYS, 'content-type': res.headers.get('content-type') ?? 'application/json' });
  const retry = res.headers.get('retry-after');
  if (retry !== null) out.set('retry-after', retry);
  return new Response(head ? null : res.body, { status: res.status, headers: out });
}

// The controls the Durable Object answers (backend.ts), and the ones this Worker answers with the buckets.
const OBJECT_CONTROLS = new Set(['GET /status', 'POST /backup', 'POST /codex/login', 'POST /codex/cancel']);
const CONTENT_CONTROLS = new Set(['GET /public', 'POST /publish', 'POST /unpublish']);

/**
 * /api/_studio/...: the Worker's own controls, never forwarded to the server. The caller (worker(), below) has
 * already made the Access check and applied the same-origin rule.
 *   GET  /api/_studio/status         the keeper's status and the container's state
 *   POST /api/_studio/backup         back up now
 *   POST /api/_studio/codex/login    start a Codex sign-in in the container (cloud/lib/codexlogin.ts)
 *   POST /api/_studio/codex/cancel   stop it
 *   GET  /api/_studio/public         what is published now (publish.ts)
 *   POST /api/_studio/publish        publish the saved public collection
 *   POST /api/_studio/unpublish      take it down
 */
export async function control(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const name = pathname.slice('/api/_studio'.length);
  const head = request.method === 'HEAD';
  const route = `${head ? 'GET' : request.method} ${name}`;

  if (CONTENT_CONTROLS.has(route)) {
    if (!env.CONTENT) {
      deps.log('config: the CONTENT bucket binding is missing');
      return jsonError(503, MESSAGES.publishOff);
    }
    // A publish also writes a history copy to the private bucket. Looking and taking down do not need it.
    if (name === '/publish' && !env.DATA) {
      deps.log('config: the DATA bucket binding is missing');
      return jsonError(503, MESSAGES.publishOff);
    }
    const d = {
      bucket: env.CONTENT,
      // The saved text comes from the server the way every API call goes to it. No header of the caller goes along.
      saved: async () => studioObject(env).fetch(new Request(`${STUDIO_ORIGIN}/public`, { headers: { accept: 'application/json' } })),
      now: deps.now ?? Date.now,
      log: deps.log,
    };
    if (name === '/public') return controlAnswer(await live(d), head);
    if (name === '/publish') return controlAnswer(await publish(request, { ...d, history: env.DATA! }), false);
    return controlAnswer(await unpublish(d), false);
  }

  if (!OBJECT_CONTROLS.has(route)) return jsonError(404, MESSAGES.notFound);
  try {
    // Only the method and the path go on: no body, no header.
    const res = await studioObject(env).fetch(new Request(`${STUDIO_ORIGIN}/_studio${name}`, { method: head ? 'GET' : request.method }));
    return controlAnswer(res, head);
  } catch (error) {
    deps.log(`container: no answer (${error instanceof Error ? error.message : 'unknown error'})`);
    return jsonError(502, MESSAGES.containerDown);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The pages

export type Route = { pattern: string; notfound: boolean };

// Exact's list of file extensions (scripts/origin.mjs FILE_EXTENSIONS): a navigation to a path ending in one of these
// is a page only when a route matches it.
const FILE_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.wasm', '.plan', '.map', '.txt', '.xml', '.pdf', '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.mp4', '.webm', '.vtt', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga',
  '.ttf', '.otf', '.woff', '.woff2', '.wgsl', '.hbc', '.model', '.tex']);

/** Whether an Accept header takes text/html (a browser's navigation), as Exact's host decides it. */
export function acceptsHTML(accept: string | null): boolean {
  return (accept ?? '').split(',').some((range) => {
    const [type, ...params] = range.split(';').map((s) => s.trim().toLowerCase());
    if (type !== 'text/html') return false;
    const q = params.find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

const segments = (path: string) => (path === '/' ? [] : path.replace(/^\//, '').split('/'));

/** Whether a route pattern matches the path, as Exact's router matches one (host/web-js/route-pattern.js). */
export function matchesRoute(routes: Route[], pathname: string): boolean {
  if (pathname !== '/' && pathname.endsWith('/')) return false;
  const parts = segments(pathname);
  return routes.some((r) => {
    if (r.notfound) return false;
    const pattern = segments(r.pattern);
    return pattern.length === parts.length && pattern.every((s, i) => (s.startsWith(':') ? parts[i] !== '' : s === parts[i]));
  });
}

/** Whether the path may be a page: no file extension, or one that is no file's, or a route matches it. */
function pagePath(pathname: string, routes: Route[]): boolean {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  const extension = dot > 0 ? last.slice(dot).toLowerCase() : '';
  return extension === '' || !FILE_EXTENSIONS.has(extension) || matchesRoute(routes, pathname);
}

/** Whether any segment of the path, decoded, starts with a dot. Such paths are never served. */
function dotPath(pathname: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return true; }
  return decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'));
}

/** Adds the studio's headers to a file response, with a new status when given. */
function served(res: Response, status = res.status): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(ALWAYS)) headers.set(name, value);
  // The build is private to the signed-in owner: browsers may keep it and ask again; shared caches may not.
  headers.set('cache-control', status === 404 ? 'no-store' : 'private, no-cache');
  if ((headers.get('content-type') ?? '').includes('text/html')) headers.set('x-frame-options', 'DENY');
  if (status !== res.status) {
    // Validators of the file belong to a 200 for its own path, not to this answer.
    headers.delete('etag');
    headers.delete('last-modified');
  }
  return new Response(res.body, { status, headers });
}

export type Pages = {
  serve(request: Request, env: Env, deps: Deps): Promise<Response>;
};

/** The page server, with routes.json read once and kept in module memory. */
export function createPages(): Pages {
  let routes: Route[] | null = null;

  async function routeTable(env: Env, origin: string, deps: Deps): Promise<Route[] | null> {
    if (routes) return routes;
    try {
      const res = await env.ASSETS.fetch(new Request(`${origin}/routes.json`));
      if (!res.ok) throw new Error(`routes.json answered ${res.status}`);
      const table = (await res.json()) as { routes?: unknown };
      if (!Array.isArray(table.routes) || !table.routes.every((r) => typeof (r as Route)?.pattern === 'string')) throw new Error('routes.json has no route table');
      routes = (table.routes as Route[]).map((r) => ({ pattern: r.pattern, notfound: r.notfound === true }));
      return routes;
    } catch (error) {
      deps.log(`pages: ${error instanceof Error ? error.message : 'routes.json could not be read'}`);
      return null;
    }
  }

  async function file(env: Env, origin: string, path: string, method: string): Promise<Response | null> {
    const res = await env.ASSETS.fetch(new Request(`${origin}${path}`, { method }));
    if (res.ok) return res;
    await res.body?.cancel().catch(() => {});
    return null;
  }

  return {
    async serve(request, env, deps) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, MESSAGES.method, { allow: 'GET, HEAD' });
      const url = new URL(request.url);
      const { pathname, origin } = url;
      // No dot path: the build's own records (.exact-build.json, .exact/) are not for the browser.
      if (dotPath(pathname)) return text(404, '');

      // The file at the path.
      const exact = await env.ASSETS.fetch(request);
      if (exact.status !== 404) return served(exact);
      await exact.body?.cancel().catch(() => {});
      // A directory's index.html (the root's is the app's page).
      if (pathname.endsWith('/')) {
        const index = await file(env, origin, `${pathname}index.html`, request.method);
        if (index) return served(index);
      }

      const navigation = acceptsHTML(request.headers.get('accept'));
      let page = false;
      if (navigation) {
        const table = await routeTable(env, origin, deps);
        // A route table that cannot be read is no answer yet, never "no such page".
        if (!table) return text(503, MESSAGES.routesUnreadable, { 'retry-after': '1' });
        if (matchesRoute(table, pathname)) {
          const shell = await file(env, origin, '/shell.html', request.method);
          if (shell) return served(shell, 200);
        }
        page = pagePath(pathname, table);
      }

      // Nothing for this path: the build's 404 page, else the app's page, whose notfound route says so.
      const missing = (await file(env, origin, '/404.html', request.method)) ?? (page ? await file(env, origin, '/shell.html', request.method) : null);
      if (missing) return served(missing, 404);
      return text(404, '');
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The Worker

/** The whole Worker: the Access check, then /api/... to the container and every other path from dist/. */
export function worker(deps: Deps) {
  const pages = createPages();
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const config = readConfig(env);
      if (!config) {
        deps.log('config: ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing or not in its form');
        return text(503, MESSAGES.notConfigured);
      }
      const verdict = await deps.gate.check(request, config);
      if (!verdict.ok) {
        deps.log(`access: refused (${verdict.reason})`);
        return text(403, MESSAGES.forbidden);
      }

      const { pathname, origin } = new URL(request.url);
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        // The sign-in rides in a cookie, so another website could make the owner's browser send a request here.
        // A browser names the calling page in Origin on every request that changes something: only the studio's
        // own page may make one.
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('origin') !== origin) {
          deps.log('api: refused a change that did not come from the studio page');
          return text(403, MESSAGES.forbidden);
        }
        // The reserved segment, in any case or spelling of it, never reaches the server.
        if (/^\/api\/_studio(\/|$)/i.test(pathname)) return control(request, env, deps);
        return api(request, env, deps);
      }
      return pages.serve(request, env, deps);
    },
  };
}
