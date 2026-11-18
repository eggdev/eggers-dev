// `bun test lib`: the four routes of the activity list, asked over HTTP of a real `server.ts` on a throw-away database.
// The server is started here on a port the system chooses (lib/testserver.ts) with --stub-github, which also gives it the test-only route that
// moves a piece of work as the worker would (POST /test/work), and is stopped by its own process id. No model is
// asked. Everything in the database is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-activity-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
// A test that runs past its time is stopped, and the server it started with it, which fails every test after it. On a
// machine busy with another test run the requests take longer: each test has a minute.
setDefaultTimeout(60_000);

beforeAll(async () => {
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
// Only the process started above is stopped, by its own id.
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
const now = async () => (await call('GET', '/activity')).body;

test('GET /activity: nothing at first; a source asked for waits, first in line, and the list is busy', async () => {
  expect(await now()).toEqual({ busy: false, lastEnded: 0, lastChanged: 0, changes: [], dueIn: 0, items: [], done: [], digest: [] });
  expect((await call('POST', '/sources', { kind: 'text', title: 'Resume 2024', body: 'Staff Engineer at Acme, 2021 to now.' })).status).toBe(201);
  expect((await call('POST', '/sources', { kind: 'text', title: 'Review notes', body: 'Led the billing export.' })).status).toBe(201);
  const a = await now();
  expect(a.busy).toBe(true);
  expect(a.items).toMatchObject([
    { kind: 'read-source', subject: '1', what: 'Reading Resume 2024', status: 'waiting', ahead: 0, usual: -1, link: '/source/1' },
    { kind: 'read-source', subject: '2', what: 'Reading Review notes', status: 'waiting', ahead: 1 },
  ]);
  expect(Object.keys(a.items[0]).sort()).toEqual(['ahead', 'endedAt', 'id', 'kind', 'link', 'reason', 'ref', 'since', 'stage', 'status', 'subject', 'took', 'usual', 'what']);
});

test('a running piece has its stage; a failure gives its reason and is in the digest', async () => {
  expect((await call('POST', '/test/work', { kind: 'read-source', id: 1, to: 'running', stage: 'Reading the second half' })).status).toBe(200);
  let a = await now();
  expect(a.items[0]).toMatchObject({ subject: '1', status: 'running', stage: 'Reading the second half', ahead: -1 });
  expect(a.items[1]).toMatchObject({ subject: '2', status: 'waiting', ahead: 1 });
  await call('POST', '/test/work', { kind: 'read-source', id: 1, to: 'failed', note: 'The text could not be read.' });
  a = await now();
  expect(a.items.map((i: { subject: string; status: string }) => [i.subject, i.status])).toEqual([['2', 'waiting'], ['1', 'failed']]);
  expect(a.items[1].reason).toBe('The text could not be read.');
  expect(a.digest).toMatchObject([{ line: 'reading Resume 2024 failed', link: '/source/1' }]);
  expect(a.lastEnded).toBeGreaterThan(0);
});

test('POST /activity/seen: the digest is given once, up to the latest line drawn', async () => {
  const shown = (await now()).digest, upTo = Math.max(...shown.map((d: { endedAt: number }) => d.endedAt));
  expect(await call('POST', '/activity/seen')).toMatchObject({ status: 400, body: { error: 'Say up to when the digest was seen.' } });
  expect(await call('POST', '/activity/seen', { at: Date.now() + 60_000 })).toMatchObject({ status: 400, body: { error: 'That time has not come yet.' } });
  expect(await call('POST', '/activity/seen', { at: upTo })).toEqual({ status: 200, body: { ok: true } });
  expect(await call('POST', '/activity/seen', { at: upTo - 1 })).toMatchObject({ status: 400, body: { error: 'A later digest has already been seen.' } });
  expect((await now()).digest).toEqual([]);
});

test('POST /activity/:id/retry asks again by the screen’s own path; only a failed row can be retried', async () => {
  const failed = (await now()).items.find((i: { status: string }) => i.status === 'failed');
  expect(await call('POST', '/activity/one/retry')).toMatchObject({ status: 400, body: { error: 'Say which piece of work, by its number.' } });
  expect(await call('POST', '/activity/one/dismiss')).toMatchObject({ status: 400, body: { error: 'Say which piece of work, by its number.' } });
  expect(await call('POST', `/activity/${failed.id}/retry`)).toEqual({ status: 200, body: { ok: true } });
  const a = await now();
  expect(a.items.filter((i: { subject: string }) => i.subject === '1').map((i: { status: string }) => i.status)).toEqual(['waiting']);
  // The same path as Read again: the source itself waits to be read.
  expect((await call('GET', '/sources')).body.find((s: { id: string }) => s.id === '1').status).toBe('queued');
  expect(await call('POST', `/activity/${failed.id}/retry`)).toMatchObject({ status: 404 });
  const waiting = a.items[0];
  expect(await call('POST', `/activity/${waiting.id}/retry`)).toMatchObject({ status: 404 });
  // The screen's own refusals come through as they are: a resume for a job not read yet cannot be written.
  await call('POST', '/jobs', { url: '', posting: 'Staff Engineer at Globex. You will lead a small team building our billing platform in Go and Postgres. Requirements: five or more years building backend systems; experience leading engineers; Go in production. Nice to have: Kafka.' });
  await call('POST', '/test/work', { kind: 'write-resume', id: 1, to: 'running' });
  await call('POST', '/test/work', { kind: 'write-resume', id: 1, to: 'failed', note: 'No reader could be reached.' });
  const resume = (await now()).items.find((i: { kind: string }) => i.kind === 'write-resume');
  expect(resume).toMatchObject({ status: 'failed', ref: 'J-001', link: '/job/1' });
  expect(await call('POST', `/activity/${resume.id}/retry`)).toMatchObject({ status: 409, body: { error: 'This job’s resume is being written now. Wait for it to finish, then change it.' } });
});

test('POST /activity/:id/dismiss puts a failed row away, and nothing else', async () => {
  const resume = (await now()).items.find((i: { kind: string }) => i.kind === 'write-resume');
  expect(await call('POST', `/activity/${resume.id}/dismiss`)).toEqual({ status: 200, body: { ok: true } });
  expect((await now()).items.find((i: { kind: string }) => i.kind === 'write-resume')).toBeUndefined();
  expect(await call('POST', `/activity/${resume.id}/dismiss`)).toMatchObject({ status: 404 });
  expect((await call('GET', '/jobs/1')).body.resumeStatus).toBe('failed');
  // A reply in Talk is asked for only by sending again there.
  await call('POST', '/talk', { body: 'I led the billing export.' });
  const reply = (await now()).items.find((i: { kind: string }) => i.kind === 'write-reply');
  await call('POST', '/test/work', { kind: 'write-reply', id: Number(reply.subject), to: 'failed', note: 'The model did not answer.' });
  expect(await call('POST', `/activity/${reply.id}/retry`)).toMatchObject({ status: 409, body: { error: 'Send your message again in Talk.' } });
});
