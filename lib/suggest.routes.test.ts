// `bun test lib`: suggestions over HTTP (rule 7, stage 3a), on a real `server.ts` (--stub-github: no PDF, no model) and a
// throw-away database made with the old schema. The owner's Save of a heading the record words otherwise makes one
// suggestion; the job's page counts it; the resume screen draws it; POST /suggestions/:id keeps, rejects and undoes it,
// and refuses in words what it cannot do. The server is stopped by its own process id. Everything is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';
import { OLD_RESUME, oldDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-suggest-routes-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
setDefaultTimeout(60_000);

beforeAll(async () => {
  oldDatabase(file);
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> }; };
const read = <T>(sql: string) => { const d = new Database(file, { readonly: true }); try { return d.query(sql).all() as T[]; } finally { d.close(); } };
const HEAD = '### Director of Engineering, Harborlight Systems', EDITED = '### Head of Engineering, Harborlight Systems';

test('a first start made the table empty; the owner’s Save makes one suggestion, counted on the job and drawn on the screen', async () => {
  expect(read('SELECT count(*) AS n FROM resume_suggestions')).toEqual([{ n: 0 }]);
  expect((await call('PATCH', '/jobs/1', { resume: OLD_RESUME.replace(HEAD, EDITED) })).status).toBe(200);
  expect(read<{ id: number; old: string; new: string; status: string }>('SELECT id, old, new, status FROM resume_suggestions')).toEqual([{ id: 1, old: EDITED, new: HEAD, status: 'open' }]);
  expect((await call('GET', '/jobs/1')).body.suggests).toBe(1);
  const v = (await call('GET', '/jobs/1/resume')).body as { rows: { kind: string; text: string; sugs: { id: string; status: string; parts: { kind: string; text: string }[] }[]; notes: { kind: string; lead: string; text: string }[] }[] };
  const h = v.rows.find((r) => r.kind === 'role' && r.text.startsWith('Head'))!;
  expect(h.sugs.map((x) => [x.id, x.status, x.parts.map((p) => `${p.kind}:${p.text}`)])).toEqual([['1', 'open', ['gone:Head', 'new:Director', 'same: of Engineering, Harborlight Systems']]]);
  expect(h.notes.filter((n) => n.kind === 'suggestion').map((n) => [n.lead, n.text])).toEqual([['Suggestion', 'Your record gives the title as “Director of Engineering”.']]);
});

test('POST /suggestions/:id refuses a body that is not an object, no action or two, and an unknown id', async () => {
  expect(await call('POST', '/suggestions/1', '[1]')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('POST', '/suggestions/1', {})).toEqual({ status: 400, body: { error: 'Send one of keep, reject or undo, set to true.' } });
  expect(await call('POST', '/suggestions/1', { keep: true, reject: true })).toEqual({ status: 400, body: { error: 'Send one of keep, reject or undo, set to true.' } });
  expect(await call('POST', '/suggestions/99', { keep: true })).toEqual({ status: 404, body: { error: 'That suggestion is gone.' } });
  expect(read('SELECT status FROM resume_suggestions')).toEqual([{ status: 'open' }]);
});

test('Keep changes the line with one letter and keeps the job edited; Undo puts it back; Reject writes only the choice', async () => {
  const letters = () => read<{ n: number }>('SELECT n FROM resume_versions WHERE job_id = 1').length;
  const before = letters();
  expect(await call('POST', '/suggestions/1', { keep: true })).toEqual({ status: 200, body: { ok: true } });
  const [kept] = read<{ resume: string; edited: number }>('SELECT resume, edited FROM jobs WHERE id = 1');
  expect([kept.resume.includes(HEAD), kept.resume.includes(EDITED), kept.edited, letters()]).toEqual([true, false, 1, before + 1]);
  expect((await call('GET', '/jobs/1')).body.suggests).toBe(0);
  expect(await call('POST', '/suggestions/1', { keep: true })).toEqual({ status: 409, body: { error: 'This suggestion was already decided.' } });
  expect(await call('POST', '/suggestions/1', { undo: true })).toEqual({ status: 200, body: { ok: true } });
  expect(read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume.includes(EDITED)).toBe(true);
  expect(letters()).toBe(before + 2);
  const resume = read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume;
  expect(await call('POST', '/suggestions/1', { reject: true })).toEqual({ status: 200, body: { ok: true } });
  expect([read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume, letters()]).toEqual([resume, before + 2]);
  expect((await call('GET', '/jobs/1')).body.suggests).toBe(0);
  expect(await call('POST', '/suggestions/1', { undo: true })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', '/jobs/1')).body.suggests).toBe(1);
});

test('a suggestion whose line the owner edited is stale and refused in words; a read writes nothing', async () => {
  const resume = read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume;
  expect((await call('PATCH', '/jobs/1', { resume: resume.replace(EDITED, '### Head of Platform, Harborlight Systems') })).status).toBe(200);
  expect(await call('POST', '/suggestions/1', { keep: true })).toEqual({ status: 409, body: { error: 'This line changed since the suggestion was made. Your words stay as they are.' } });
  const changes = () => read<{ n: number }>("SELECT count(*) AS n FROM resume_suggestions")[0].n + read<{ n: number }>('SELECT count(*) AS n FROM resume_versions')[0].n;
  const at = changes(), rows = read('SELECT * FROM resume_suggestions');
  for (const path of ['/jobs/1', '/jobs/1/resume', '/jobs']) expect((await call('GET', path)).status).toBe(200);
  expect([changes(), read('SELECT * FROM resume_suggestions')]).toEqual([at, rows]);
});
