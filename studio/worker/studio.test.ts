// Tests for the studio's Worker with fake bindings: the Access check in front of everything, the API forwarded to a
// fake server, and the pages served by Exact's hosting rule. Nothing here calls Cloudflare.
// Run from studio/: `bun run test`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { createGate } from './access.ts';
import { acceptsHTML, matchesRoute, MESSAGES, worker, type Env, type Route } from './studio.ts';
import { AUD, certsEndpoint, makeSigner, NOW, sign, TEAM, type Signer } from './test-keys.ts';

let signer: Signer;
let token: string;
beforeAll(async () => {
  signer = await makeSigner('key-main');
  token = await sign(signer);
});

const ROUTES: Route[] = [
  { pattern: '/', notfound: false },
  { pattern: '/profile', notfound: false },
  { pattern: '/jobs', notfound: false },
  { pattern: '/job/:id', notfound: false },
  { pattern: '/job/:id/resume', notfound: false },
  { pattern: '', notfound: true },
];
const SHELL = '<!doctype html><title>shell</title>';
const INDEX = '<!doctype html><title>index</title>';

/** A fake assets binding with html_handling "none": a file only at its exact path. */
function assets(extra: Record<string, string> = {}) {
  const files: Record<string, { body: string; type: string }> = {
    '/index.html': { body: INDEX, type: 'text/html; charset=utf-8' },
    '/shell.html': { body: SHELL, type: 'text/html; charset=utf-8' },
    '/routes.json': { body: JSON.stringify({ routes: ROUTES }), type: 'application/json' },
    '/app.js': { body: 'console.log(1)', type: 'text/javascript' },
    '/.exact-build.json': { body: '{"secret":"build record"}', type: 'application/json' },
  };
  for (const [path, body] of Object.entries(extra)) files[path] = { body, type: 'text/html; charset=utf-8' };
  const calls: string[] = [];
  return {
    calls,
    fetch: async (r: Request) => {
      const { pathname } = new URL(r.url);
      calls.push(pathname);
      const f = files[pathname];
      if (!f) return new Response('', { status: 404 });
      return new Response(r.method === 'HEAD' ? null : f.body, { headers: { 'content-type': f.type, etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' } });
    },
  };
}

type Call = { url: string; init: RequestInit };
function server(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  return { calls, fetch: async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return respond(url, init); } };
}

function setup(over: Partial<Env> = {}, respond: (url: string, init: RequestInit) => Response | Promise<Response> = () => Response.json({ ok: true })) {
  const certs = certsEndpoint([signer]);
  const logs: string[] = [];
  const env = { ASSETS: assets(), SERVER: server(respond), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...over };
  const w = worker({ gate: createGate({ fetch: certs.fetch, now: () => NOW }), log: (m) => { logs.push(m); } });
  return { env, w, logs, certs };
}

const NAV = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const get = (path: string, headers: Record<string, string> = {}, signed = true) =>
  new Request(`https://studio.eggers.dev${path}`, { headers: { ...(signed ? { 'cf-access-jwt-assertion': token } : {}), ...headers } });

// ---------------------------------------------------------------------------------------------------------------

describe('the Access check in front of everything', () => {
  test('missing settings: 503, and nothing is served or forwarded', async () => {
    for (const over of [{ ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_AUD: undefined }, { ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'not a host' }]) {
      const { env, w, certs } = setup(over);
      const res = await w.fetch(get('/'), env);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(MESSAGES.notConfigured);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(env.ASSETS.calls).toEqual([]);
      expect(certs.calls).toEqual([]);
      const api = await w.fetch(get('/api/jobs'), env);
      expect(api.status).toBe(503);
      expect(env.SERVER.calls).toEqual([]);
    }
  });

  test('no token: 403 with the same short message, and nothing is served or forwarded', async () => {
    const { env, w } = setup();
    for (const path of ['/', '/app.js', '/jobs', '/api/jobs']) {
      const res = await w.fetch(get(path, NAV, false), env);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(MESSAGES.forbidden);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(env.ASSETS.calls).toEqual([]);
    expect(env.SERVER.calls).toEqual([]);
  });

  test('a bad token: 403, the reason only in the log, the token never', async () => {
    const { env, w, logs } = setup();
    const bad = token.slice(0, -4) + 'AAAA';
    const res = await w.fetch(get('/app.js', { 'cf-access-jwt-assertion': bad }, false), env);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(MESSAGES.forbidden);
    expect(env.ASSETS.calls).toEqual([]);
    expect(logs.join('\n')).toContain('access: refused');
    for (const part of bad.split('.')) expect(logs.join('\n')).not.toContain(part);
  });

  test('the cookie alone is enough (a resume PDF opened from a link)', async () => {
    const { env, w } = setup();
    const res = await w.fetch(get('/app.js', { cookie: `CF_Authorization=${token}` }, false), env);
    expect(res.status).toBe(200);
  });

  test('a page path goes to the assets only after the check passes', async () => {
    const { env, w } = setup();
    await w.fetch(get('/jobs', NAV, false), env);
    expect(env.ASSETS.calls).toEqual([]);
    const res = await w.fetch(get('/jobs', NAV), env);
    expect(res.status).toBe(200);
    expect(env.ASSETS.calls[0]).toBe('/jobs');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the API', () => {
  test('/api/jobs/3?x=1 goes to the server as /jobs/3?x=1 with its method and body, and without cookie or cf-* headers', async () => {
    const { env, w } = setup({}, () => new Response('{"saved":true}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'x-internal': 'yes' },
    }));
    const req = new Request('https://studio.eggers.dev/api/jobs/3?x=1', {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': token,
        cookie: `CF_Authorization=${token}; theme=dark`,
        'cf-connecting-ip': '203.0.113.7',
        'cf-ray': '0000000000000000-AAA',
        'cf-access-authenticated-user-email': 'ada@example.com',
        authorization: 'Bearer not-needed',
        origin: 'https://studio.eggers.dev',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{"resume":"text"}',
    });
    const res = await w.fetch(req, env);
    expect(env.SERVER.calls.length).toBe(1);
    const call = env.SERVER.calls[0]!;
    expect(call.url).toBe('http://127.0.0.1:8787/jobs/3?x=1');
    expect(call.init.method).toBe('PATCH');
    expect(await new Response(call.init.body).text()).toBe('{"resume":"text"}');
    const sent = new Headers(call.init.headers);
    expect([...sent.keys()].sort()).toEqual(['accept', 'content-type']);
    expect(env.ASSETS.calls).toEqual([]);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"saved":true}');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
    expect(res.headers.get('x-internal')).toBeNull();
  });

  test('a change that does not come from the studio page is refused before the server', async () => {
    const { env, w } = setup();
    for (const origin of [undefined, 'https://example.com', 'null', 'http://studio.eggers.dev', 'https://studio.eggers.dev.example.com']) {
      for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
        const headers: Record<string, string> = { 'cf-access-jwt-assertion': token, 'content-type': 'text/plain' };
        if (origin !== undefined) headers.origin = origin;
        const res = await w.fetch(new Request('https://studio.eggers.dev/api/facts/1', { method, headers, body: '{}' }), env);
        expect(res.status).toBe(403);
      }
    }
    expect(env.SERVER.calls).toEqual([]);
  });

  test('a read needs no origin; a change from the studio page passes', async () => {
    const { env, w } = setup();
    expect((await w.fetch(get('/api/bank'), env)).status).toBe(200);
    const res = await w.fetch(new Request('https://studio.eggers.dev/api/facts/1', {
      method: 'DELETE',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://studio.eggers.dev' },
    }), env);
    expect(res.status).toBe(200);
    expect(env.SERVER.calls.map((c) => c.init.method)).toEqual(['GET', 'DELETE']);
  });

  test('/api alone is the server root; /apix is not the API', async () => {
    const { env, w } = setup();
    await w.fetch(get('/api'), env);
    expect(env.SERVER.calls[0]!.url).toBe('http://127.0.0.1:8787/');
    const res = await w.fetch(get('/apix', NAV), env);
    expect(env.SERVER.calls.length).toBe(1);
    expect(res.status).toBe(404);
  });

  test('a GET sends no body', async () => {
    const { env, w } = setup();
    await w.fetch(get('/api/health'), env);
    expect(env.SERVER.calls[0]!.init.method).toBe('GET');
    expect(env.SERVER.calls[0]!.init.body ?? null).toBeNull();
  });

  test('an upload is passed on as a stream, not read whole first', async () => {
    let pulled = 0;
    const upload = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled <= 3) c.enqueue(new Uint8Array(1024).fill(pulled));
        else c.close();
      },
    });
    let bodyWasStream = false;
    let pulledBeforeServer = -1;
    const { env, w } = setup({}, async (_url, init) => {
      bodyWasStream = init.body instanceof ReadableStream;
      pulledBeforeServer = pulled;
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      return Response.json({ received: bytes.length });
    });
    const req = new Request('https://studio.eggers.dev/api/sources/upload?name=notes.pdf', {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: 'https://studio.eggers.dev', 'content-type': 'application/octet-stream' },
      body: upload,
      duplex: 'half',
    } as RequestInit);
    const res = await w.fetch(req, env);
    expect(bodyWasStream).toBe(true);
    // The Worker had not read the upload when the server got it (a stream may pull one chunk ahead).
    expect(pulledBeforeServer).toBeLessThanOrEqual(1);
    expect(await res.json()).toEqual({ received: 3072 });
    expect(env.SERVER.calls[0]!.url).toBe('http://127.0.0.1:8787/sources/upload?name=notes.pdf');
  });

  test('the answer is streamed back, with its download headers', async () => {
    let close: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('%PDF-1.7 first part'));
        close = () => c.close();
      },
    });
    const { env, w } = setup({}, () => new Response(body, {
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="resume.pdf"', 'access-control-allow-origin': '*' },
    }));
    // Only the cookie, as when the browser opens the PDF link.
    const ok = await w.fetch(get('/api/jobs/3/resume.pdf', { cookie: `CF_Authorization=${token}` }, false), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="resume.pdf"');
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
    const reader = ok.body!.getReader();
    // The first part arrives while the server's stream is still open.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('%PDF-1.7 first part');
    close();
    expect((await reader.read()).done).toBe(true);
  });

  test('a server that cannot be reached: 502 with JSON the page shows', async () => {
    const { env, w, logs } = setup({}, () => { throw new Error('connect ECONNREFUSED'); });
    const res = await w.fetch(get('/api/jobs'), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The studio's server is not running. Start it on the machine that holds the data." });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logs.join('\n')).toContain('server: no connection');
  });

  test('a missing SERVER binding is the same 502', async () => {
    const { env, w } = setup({ SERVER: undefined });
    const res = await w.fetch(get('/api/jobs'), env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe(MESSAGES.serverDown);
  });

  test("the tunnel's own error page becomes the same 502; the server's own JSON errors pass through", async () => {
    const tunnel = setup({}, () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const a = await tunnel.w.fetch(get('/api/jobs'), tunnel.env);
    expect(a.status).toBe(502);
    expect(((await a.json()) as { error: string }).error).toBe(MESSAGES.serverDown);
    const own = setup({}, () => Response.json({ error: 'Busy.' }, { status: 503 }));
    const b = await own.w.fetch(get('/api/jobs'), own.env);
    expect(b.status).toBe(503);
    expect(await b.json()).toEqual({ error: 'Busy.' });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the pages, by Exact’s hosting rule', () => {
  test('a file at its path, with the studio headers', async () => {
    const { env, w } = setup();
    const res = await w.fetch(get('/app.js'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  test('/ is index.html', async () => {
    const { env, w } = setup();
    const res = await w.fetch(get('/', NAV), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  test('a navigation to a route is shell.html with 200', async () => {
    const { env, w } = setup();
    for (const path of ['/jobs', '/profile', '/job/12', '/job/12/resume']) {
      const res = await w.fetch(get(path, NAV), env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SHELL);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  test('routes.json is read once', async () => {
    const { env, w } = setup();
    await w.fetch(get('/jobs', NAV), env);
    await w.fetch(get('/profile', NAV), env);
    expect(env.ASSETS.calls.filter((p) => p === '/routes.json').length).toBe(1);
  });

  test('a navigation to an unknown page is shell.html with 404, so the app draws its notfound route', async () => {
    const { env, w } = setup();
    for (const path of ['/nope', '/job/12/', '/job', '/jobs/12/extra']) {
      const res = await w.fetch(get(path, NAV), env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(SHELL);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('etag')).toBeNull();
    }
  });

  test("the build's 404.html wins when it has one", async () => {
    const { env, w } = setup({ ASSETS: assets({ '/404.html': '<p>missing</p>' }) });
    const res = await w.fetch(get('/nope', NAV), env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('<p>missing</p>');
  });

  test('a missing file, or a page asked for without text/html, is an empty 404', async () => {
    const { env, w } = setup();
    for (const [path, headers] of [['/missing.js', NAV], ['/jobs', { accept: '*/*' }], ['/jobs', {}], ['/jobs', { accept: 'text/html;q=0' }]] as const) {
      const res = await w.fetch(get(path, headers), env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  test('dot paths are never served', async () => {
    const { env, w } = setup();
    for (const path of ['/.exact-build.json', '/.exact/install/index.html', '/%2eexact-build.json']) {
      const res = await w.fetch(get(path, NAV), env);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
    expect(env.ASSETS.calls).toEqual([]);
  });

  test('a page answers GET and HEAD only', async () => {
    const { env, w } = setup();
    const res = await w.fetch(new Request('https://studio.eggers.dev/jobs', { method: 'POST', headers: { 'cf-access-jwt-assertion': token }, body: 'x' }), env);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    const head = await w.fetch(new Request('https://studio.eggers.dev/jobs', { method: 'HEAD', headers: { 'cf-access-jwt-assertion': token, ...NAV } }), env);
    expect(head.status).toBe(200);
  });

  test('an unreadable routes.json is 503, never a 404 for a real page', async () => {
    const broken = { calls: [] as string[], fetch: async (r: Request) => new Response('', { status: new URL(r.url).pathname === '/routes.json' ? 500 : 404 }) };
    const { env, w } = setup({ ASSETS: broken });
    const res = await w.fetch(get('/jobs', NAV), env);
    expect(res.status).toBe(503);
  });
});

describe('helpers', () => {
  test('acceptsHTML', () => {
    expect(acceptsHTML(NAV.accept)).toBe(true);
    expect(acceptsHTML('text/html')).toBe(true);
    expect(acceptsHTML('TEXT/HTML; q=0.5')).toBe(true);
    expect(acceptsHTML('text/html;q=0')).toBe(false);
    expect(acceptsHTML('*/*')).toBe(false);
    expect(acceptsHTML(null)).toBe(false);
  });

  test('matchesRoute', () => {
    expect(matchesRoute(ROUTES, '/')).toBe(true);
    expect(matchesRoute(ROUTES, '/job/7')).toBe(true);
    expect(matchesRoute(ROUTES, '/job/')).toBe(false);
    expect(matchesRoute(ROUTES, '/jobs/')).toBe(false);
    expect(matchesRoute(ROUTES, '/job/7/resume')).toBe(true);
    expect(matchesRoute(ROUTES, '/job/7/other')).toBe(false);
    expect(matchesRoute(ROUTES, '')).toBe(false);
  });
});
