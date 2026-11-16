// Tests for the studio's Worker with fake bindings: the Access check in front of everything, the API forwarded to a
// fake Durable Object (the container), the reserved /api/_studio controls (the status, a backup, the Codex sign-in,
// the publish step with a fake bucket), and the pages served by Exact's hosting rule. Nothing here calls Cloudflare.
// Run from studio/: `bun run test`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { createGate } from './access.ts';
import { FakeBucket } from './fake-bucket.ts';
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

type Respond = (r: Request) => Response | Promise<Response>;

/** A fake Durable Object namespace: one object, which answers with `respond` and records each request. */
function studio(respond: Respond = () => Response.json({ ok: true })) {
  const calls: { name: string; url: string; method: string; headers: Headers; hasBody: boolean }[] = [];
  return {
    calls,
    getByName(name: string) {
      return {
        async fetch(r: Request) {
          calls.push({ name, url: r.url, method: r.method, headers: new Headers(r.headers), hasBody: r.body !== null });
          return respond(r);
        },
      };
    },
  };
}

function setup(respond?: Respond, over: Partial<Env> = {}) {
  const certs = certsEndpoint([signer]);
  const logs: string[] = [];
  const env = { ASSETS: assets(), STUDIO: studio(respond), CONTENT: new FakeBucket(), DATA: new FakeBucket(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...over } as Env & { ASSETS: ReturnType<typeof assets> };
  const w = worker({ gate: createGate({ fetch: certs.fetch, now: () => NOW }), log: (m) => { logs.push(m); }, now: () => PUBLISH_AT });
  // `bucket` is CONTENT, which the public website reads; `data` is the private DATA, where the history goes.
  return { env, w, logs, certs, studio: env.STUDIO as ReturnType<typeof studio>, bucket: env.CONTENT as FakeBucket, data: env.DATA as FakeBucket };
}

const ORIGIN = 'https://studio.eggers.dev';
const PUBLISH_AT = Date.UTC(2026, 10, 16, 18, 30, 5, 123);
const NAV = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const get = (path: string, headers: Record<string, string> = {}, signed = true) =>
  new Request(`${ORIGIN}${path}`, { headers: { ...(signed ? { 'cf-access-jwt-assertion': token } : {}), ...headers } });
/** A POST from the studio's own page, signed in, unless told otherwise. */
const post = (path: string, body?: unknown, o: { signed?: boolean; origin?: string | null } = {}) => {
  const headers: Record<string, string> = {};
  if (o.signed !== false) headers['cf-access-jwt-assertion'] = token;
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

const hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------------------------------------------------------

describe('the Access check in front of everything', () => {
  test('missing settings: 503, and nothing is served or forwarded', async () => {
    for (const over of [{ ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_AUD: undefined }, { ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'not a host' }]) {
      const { env, w, certs, studio: s, bucket } = setup(undefined, over);
      const res = await w.fetch(get('/'), env);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(MESSAGES.notConfigured);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(env.ASSETS.calls).toEqual([]);
      expect(certs.calls).toEqual([]);
      const api = await w.fetch(get('/api/jobs'), env);
      expect(api.status).toBe(503);
      expect((await w.fetch(post('/api/_studio/unpublish'), env)).status).toBe(503);
      expect(s.calls).toEqual([]);
      expect(bucket.ops).toEqual([]);
    }
  });

  test('no token: 403 with the same short message, and nothing is served or forwarded', async () => {
    const { env, w, studio: s } = setup();
    for (const path of ['/', '/app.js', '/jobs', '/api/jobs']) {
      const res = await w.fetch(get(path, NAV, false), env);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(MESSAGES.forbidden);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(env.ASSETS.calls).toEqual([]);
    expect(s.calls).toEqual([]);
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

describe('the API, forwarded to the container', () => {
  test('/api/jobs/3?x=1 goes to the Durable Object "studio" as /jobs/3?x=1 with its method and body, and without cookie or cf-* headers', async () => {
    let received = '';
    const { env, w, studio: s } = setup(async (r) => {
      received = await r.text();
      return new Response('{"saved":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'x-internal': 'yes', 'retry-after': '5' },
      });
    });
    const req = new Request(`${ORIGIN}/api/jobs/3?x=1`, {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': token,
        cookie: `CF_Authorization=${token}; theme=dark`,
        'cf-connecting-ip': '203.0.113.7',
        'cf-ray': '0000000000000000-AAA',
        'cf-access-authenticated-user-email': 'ada@example.com',
        authorization: 'Bearer not-needed',
        origin: ORIGIN,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{"resume":"text"}',
    });
    const res = await w.fetch(req, env);
    expect(s.calls.length).toBe(1);
    const call = s.calls[0]!;
    expect(call.name).toBe('studio');
    expect(call.url).toBe('http://studio/jobs/3?x=1');
    expect(call.method).toBe('PATCH');
    expect(received).toBe('{"resume":"text"}');
    expect([...call.headers.keys()].sort()).toEqual(['accept', 'content-type']);
    expect(env.ASSETS.calls).toEqual([]);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"saved":true}');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
    expect(res.headers.get('x-internal')).toBeNull();
  });

  test('a change that does not come from the studio page is refused before the container', async () => {
    const { env, w, studio: s } = setup();
    for (const origin of [undefined, 'https://example.com', 'null', 'http://studio.eggers.dev', 'https://studio.eggers.dev.example.com']) {
      for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
        const headers: Record<string, string> = { 'cf-access-jwt-assertion': token, 'content-type': 'text/plain' };
        if (origin !== undefined) headers.origin = origin;
        const res = await w.fetch(new Request(`${ORIGIN}/api/facts/1`, { method, headers, body: '{}' }), env);
        expect(res.status).toBe(403);
      }
    }
    expect(s.calls).toEqual([]);
  });

  test('a read needs no origin; a change from the studio page passes', async () => {
    const { env, w, studio: s } = setup();
    expect((await w.fetch(get('/api/bank'), env)).status).toBe(200);
    const res = await w.fetch(new Request(`${ORIGIN}/api/facts/1`, {
      method: 'DELETE',
      headers: { 'cf-access-jwt-assertion': token, origin: ORIGIN },
    }), env);
    expect(res.status).toBe(200);
    expect(s.calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
  });

  test('/api alone is the server root; /apix is not the API', async () => {
    const { env, w, studio: s } = setup();
    await w.fetch(get('/api'), env);
    expect(s.calls[0]!.url).toBe('http://studio/');
    const res = await w.fetch(get('/apix', NAV), env);
    expect(s.calls.length).toBe(1);
    expect(res.status).toBe(404);
  });

  test('a GET sends no body', async () => {
    const { env, w, studio: s } = setup();
    await w.fetch(get('/api/health'), env);
    expect(s.calls[0]!.method).toBe('GET');
    expect(s.calls[0]!.hasBody).toBe(false);
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
    let pulledBeforeServer = -1;
    const { env, w, studio: s } = setup(async (r) => {
      pulledBeforeServer = pulled;
      const bytes = new Uint8Array(await r.arrayBuffer());
      return Response.json({ received: bytes.length });
    });
    const req = new Request(`${ORIGIN}/api/sources/upload?name=notes.pdf`, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, origin: ORIGIN, 'content-type': 'application/octet-stream' },
      body: upload,
      duplex: 'half',
    } as RequestInit);
    const res = await w.fetch(req, env);
    // The Worker had not read the upload when the container got it (a stream may pull one chunk ahead).
    expect(pulledBeforeServer).toBeLessThanOrEqual(1);
    expect(await res.json()).toEqual({ received: 3072 });
    expect(s.calls[0]!.url).toBe('http://studio/sources/upload?name=notes.pdf');
    expect(s.calls[0]!.hasBody).toBe(true);
  });

  test('the answer is streamed back, with its download headers', async () => {
    let close: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('%PDF-1.7 first part'));
        close = () => c.close();
      },
    });
    const { env, w } = setup(() => new Response(body, {
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

  test("the Durable Object's 503 while the container starts reaches the page as JSON with retry-after", async () => {
    const { env, w } = setup(() => Response.json({ error: MESSAGES.starting }, { status: 503, headers: { 'retry-after': '5' } }));
    const res = await w.fetch(get('/api/bank'), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ error: "The studio's server is starting. Try again in a moment." });
  });

  test("the server's own JSON errors pass through", async () => {
    const { env, w } = setup(() => Response.json({ error: 'Busy.' }, { status: 503 }));
    const res = await w.fetch(get('/api/jobs'), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Busy.' });
  });

  test('a Durable Object that throws, or a missing STUDIO binding: 502 with JSON the page shows', async () => {
    const thrown = setup(() => { throw new Error('internal error'); });
    const a = await thrown.w.fetch(get('/api/bank'), thrown.env);
    expect(a.status).toBe(502);
    expect(await a.json()).toEqual({ error: "The studio's server is not answering. Try again in a moment." });
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(thrown.logs.join('\n')).toContain('container: no answer');
    const missing = setup(undefined, { STUDIO: undefined });
    const b = await missing.w.fetch(get('/api/bank'), missing.env);
    expect(b.status).toBe(502);
    expect(((await b.json()) as { error: string }).error).toBe(MESSAGES.containerDown);
  });

  test('the container is the only backend: a STUDIO_BACKEND setting left in the environment changes nothing', async () => {
    const { env, w, studio: s } = setup(undefined, { STUDIO_BACKEND: 'tunnel', SERVER: { fetch: () => { throw new Error('never called'); } } } as Partial<Env>);
    const res = await w.fetch(get('/api/bank'), env);
    expect(res.status).toBe(200);
    expect(s.calls.map((c) => c.url)).toEqual(['http://studio/bank']);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the studio controls at /api/_studio', () => {
  const STATUS = { backend: 'container', keeper: { phase: 'running', lastBackup: { key: 'backups/x.tar.gz' }, codexLogin: { state: 'idle' } } };
  const LOGIN = { ok: true, codexLogin: { state: 'waiting', url: 'https://auth.example.com/device', code: 'ABCD-12345', startedAt: 1 } };
  const controls = (over: Partial<Env> = {}) => setup((r) => {
    const { pathname } = new URL(r.url);
    if (pathname === '/_studio/status') return Response.json(STATUS);
    if (pathname === '/_studio/codex/login') return Response.json(LOGIN);
    if (pathname === '/_studio/codex/cancel') return Response.json({ ok: true, codexLogin: { state: 'idle', detail: 'cancelled' } });
    return Response.json({ ok: true });
  }, over);

  test('GET /api/_studio/status answers from the Durable Object, with the backend field readers know', async () => {
    const { env, w, studio: s } = controls();
    const res = await w.fetch(get('/api/_studio/status'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof STATUS;
    expect(body).toEqual(STATUS);
    expect(body.backend).toBe('container');
    expect(s.calls.map((c) => c.url)).toEqual(['http://studio/_studio/status']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  test('it needs the Access sign-in like everything else', async () => {
    const { env, w, studio: s, bucket } = controls();
    for (const path of ['/api/_studio/status', '/api/_studio/public']) {
      const res = await w.fetch(get(path, {}, false), env);
      expect(res.status).toBe(403);
    }
    expect(s.calls).toEqual([]);
    expect(bucket.ops).toEqual([]);
  });

  test('POST /api/_studio/backup needs the studio page as its origin', async () => {
    const { env, w, studio: s } = controls();
    const refused = await w.fetch(post('/api/_studio/backup', undefined, { origin: null }), env);
    expect(refused.status).toBe(403);
    const ok = await w.fetch(post('/api/_studio/backup'), env);
    expect(ok.status).toBe(200);
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST http://studio/_studio/backup']);
  });

  test('the _studio segment is never forwarded, whatever follows it or however it is written', async () => {
    const { env, w, studio: s } = controls();
    for (const path of ['/api/_studio', '/api/_studio/', '/api/_studio/other', '/api/_STUDIO/status/x', '/api/_studio/codex', '/api/_studio/codex/login', '/api/_studio/publish', '/api/_studio/status?x=1&y=2/..']) {
      const res = await w.fetch(get(path), env);
      if (path.startsWith('/api/_studio/status?')) expect(res.status).toBe(200);
      else expect(res.status).toBe(404);
    }
    expect(s.calls.every((c) => c.url === 'http://studio/_studio/status')).toBe(true);
  });

  test('POST /api/_studio/codex/login and /cancel pass to the Durable Object and return the keeper\'s JSON', async () => {
    const { env, w, studio: s } = controls();
    // The page's body and headers do not go on: the sign-in takes no input.
    const login = await w.fetch(post('/api/_studio/codex/login', { cmd: 'ignored' }), env);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual(LOGIN);
    expect(login.headers.get('cache-control')).toBe('no-store');
    const cancel = await w.fetch(post('/api/_studio/codex/cancel'), env);
    expect(await cancel.json()).toEqual({ ok: true, codexLogin: { state: 'idle', detail: 'cancelled' } });
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST http://studio/_studio/codex/login', 'POST http://studio/_studio/codex/cancel']);
    expect(s.calls.every((c) => !c.hasBody && [...c.headers.keys()].length === 0)).toBe(true);
  });

  test('a sign-in asked for while the container starts: the 503 and its retry-after reach the page', async () => {
    const { env, w } = setup(() => Response.json({ error: MESSAGES.starting }, { status: 503, headers: { 'retry-after': '5' } }));
    const res = await w.fetch(post('/api/_studio/codex/login'), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ error: MESSAGES.starting });
  });

  test('the Codex sign-in needs the Access sign-in and the studio page as its origin', async () => {
    const { env, w, studio: s } = controls();
    for (const path of ['/api/_studio/codex/login', '/api/_studio/codex/cancel']) {
      expect((await w.fetch(post(path, undefined, { signed: false }), env)).status).toBe(403);
      expect((await w.fetch(post(path, undefined, { origin: null }), env)).status).toBe(403);
      expect((await w.fetch(post(path, undefined, { origin: 'https://example.com' }), env)).status).toBe(403);
    }
    expect(s.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('the public collection at /api/_studio/public, /publish and /unpublish', () => {
  const TEXT = '# An invented person\n\nThey built an invented thing.\n';
  /** A Worker whose container answers GET /public with this saved text. */
  const publishing = async (text = TEXT) => {
    const sha256 = await hex(text);
    const s = setup((r) => (new URL(r.url).pathname === '/public' ? Response.json({ text, savedAt: 1, sha256, notes: [] }) : Response.json({ error: 'not the route' }, { status: 404 })));
    return { ...s, sha256 };
  };

  test('publish, then the public state, then unpublish: through the Worker, with the studio headers', async () => {
    const { env, w, studio: s, bucket, data, sha256, logs } = await publishing();
    const before = await w.fetch(get('/api/_studio/public'), env);
    expect(await before.json()).toEqual({ live: null });

    const res = await w.fetch(post('/api/_studio/publish', { sha256 }), env);
    expect(res.status).toBe(200);
    const live = { sha256, publishedAt: '2026-11-16T18:30:05.123Z', size: new TextEncoder().encode(TEXT).length };
    expect(await res.json()).toEqual({ ok: true, live });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    // The saved text was asked of the container as GET /public, with nothing of the caller's.
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET http://studio/public']);
    expect([...s.calls[0]!.headers.keys()]).toEqual(['accept']);
    expect(new TextDecoder().decode(bucket.objects.get('collection.md'))).toBe(TEXT);
    expect([...bucket.objects.keys()]).toEqual(['collection.md']);

    const after = await w.fetch(get('/api/_studio/public'), env);
    expect(await after.json()).toEqual({ live });
    const head = await w.fetch(new Request(`${ORIGIN}/api/_studio/public`, { method: 'HEAD', headers: { 'cf-access-jwt-assertion': token } }), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const down = await w.fetch(post('/api/_studio/unpublish'), env);
    expect(await down.json()).toEqual({ ok: true, live: null });
    // The bucket the public website reads is empty again; the history copy is in the private bucket.
    expect([...bucket.objects.keys()]).toEqual([]);
    expect([...data.objects.keys()]).toEqual(['public-history/2026-11-16T18-30-05-123Z.md']);
    expect(await (await w.fetch(get('/api/_studio/public'), env)).json()).toEqual({ live: null });
    // The log has the time and the sha256, never the text.
    expect(logs).toContain(`publish: 2026-11-16T18:30:05.123Z sha256 ${sha256}`);
    expect(logs).toContain(`unpublish: 2026-11-16T18:30:05.123Z sha256 ${sha256}`);
    expect(logs.join('\n')).not.toContain('invented');
  });

  test('without a valid Access token, nothing reaches the buckets or the container', async () => {
    const { env, w, studio: s, bucket, data, sha256 } = await publishing();
    const bad = token.slice(0, -4) + 'AAAA';
    const requests = [
      get('/api/_studio/public', {}, false),
      post('/api/_studio/publish', { sha256 }, { signed: false }),
      post('/api/_studio/unpublish', undefined, { signed: false }),
      new Request(`${ORIGIN}/api/_studio/publish`, { method: 'POST', headers: { 'cf-access-jwt-assertion': bad, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ sha256 }) }),
      new Request(`${ORIGIN}/api/_studio/unpublish`, { method: 'POST', headers: { cookie: `CF_Authorization=${bad}`, origin: ORIGIN } }),
    ];
    for (const r of requests) {
      const res = await w.fetch(r, env);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(MESSAGES.forbidden);
    }
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  test('a POST from another origin, or with none, never reaches the buckets or the container', async () => {
    const { env, w, studio: s, bucket, data, sha256 } = await publishing();
    bucket.objects.set('collection.md', new TextEncoder().encode('live text'));
    for (const origin of [null, 'https://example.com', 'null', 'http://studio.eggers.dev', 'https://studio.eggers.dev.example.com']) {
      expect((await w.fetch(post('/api/_studio/publish', { sha256 }, { origin }), env)).status).toBe(403);
      expect((await w.fetch(post('/api/_studio/unpublish', undefined, { origin }), env)).status).toBe(403);
    }
    expect(bucket.ops).toEqual([]);
    expect(data.ops).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(bucket.objects.has('collection.md')).toBe(true);
  });

  test('only the named methods: a GET never publishes or unpublishes', async () => {
    const { env, w, studio: s, bucket } = await publishing();
    for (const path of ['/api/_studio/publish', '/api/_studio/unpublish']) expect((await w.fetch(get(path), env)).status).toBe(404);
    expect((await w.fetch(post('/api/_studio/public'), env)).status).toBe(404);
    expect(bucket.ops).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  test('a container that is starting: its answer passes through, and nothing is written', async () => {
    const { env, w, bucket } = setup(() => Response.json({ error: MESSAGES.starting }, { status: 503, headers: { 'retry-after': '5' } }));
    const res = await w.fetch(post('/api/_studio/publish', { sha256: 'a'.repeat(64) }), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({ error: "The studio's server is starting. Try again in a moment." });
    expect(bucket.ops).toEqual([]);
  });

  test('a missing DATA binding: a publish is 503 and writes nothing; looking and taking down still work', async () => {
    const { env, w, studio: s, bucket, sha256 } = await (async () => {
      const p = await publishing();
      return { ...p, env: { ...p.env, DATA: undefined } };
    })();
    bucket.objects.set('collection.md', new TextEncoder().encode('live text'));
    const res = await w.fetch(post('/api/_studio/publish', { sha256 }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MESSAGES.publishOff });
    expect(bucket.ops).toEqual([]);
    expect(s.calls).toEqual([]);
    expect((await w.fetch(get('/api/_studio/public'), env)).status).toBe(200);
    // The emergency stop does not depend on the private bucket.
    expect(await (await w.fetch(post('/api/_studio/unpublish'), env)).json()).toEqual({ ok: true, live: null });
    expect(bucket.objects.has('collection.md')).toBe(false);
  });

  test('a missing CONTENT binding: 503 that says so, and the container is not asked', async () => {
    const { env, w, studio: s } = setup(undefined, { CONTENT: undefined });
    for (const r of [get('/api/_studio/public'), post('/api/_studio/publish', { sha256: 'a'.repeat(64) }), post('/api/_studio/unpublish')]) {
      const res = await w.fetch(r, env);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: MESSAGES.publishOff });
    }
    expect(s.calls).toEqual([]);
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
    const { env, w } = setup(undefined, { ASSETS: assets({ '/404.html': '<p>missing</p>' }) });
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
    const { env, w } = setup(undefined, { ASSETS: broken });
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
