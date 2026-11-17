// `bun test lib`: the new routes, asked over HTTP of a real `server.ts` that runs on a throw-away database made
// with the old schema (lib/oldschema.ts). The server is started here on a spare local port and is stopped by its
// own process id. It never prints a PDF (--stub-github) and never asks a model. Everything in the database is invented.
// What it proves: answering a raised question, or marking a skill, changes no stored resume by itself; a raised
// question stays open until it is answered here; a review of the skills list needs to be asked for, and can be refused.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OLD_RESUME, oldDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-routes-')), file = join(dir, 'egg.db');
const SECOND = '# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n\n## Skills\nGo, TypeScript, synergy';
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';

beforeAll(async () => {
  oldDatabase(file);
  const d = new Database(file);
  // Two unsent resumes that a model wrote (edited = 0), and a second current job so the timeline has something to ask.
  d.run('UPDATE jobs SET edited = 0');
  d.query("INSERT INTO jobs (id, posting, title, company, status, fit, analysis, resume, created_at, edited, outcome) VALUES (2, 'A posting about Go and TypeScript.', 'Engineer', 'Nimbus Yard', 'done', 50, ?, ?, 2, 0, '')")
    .run(JSON.stringify({ verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] }), SECOND);
  d.run("INSERT INTO roles (id, company, title, start, end, standing) VALUES (4, 'Lantern Notes', 'Founder', '2023-06', '', 'own')");
  d.close();
  // A spare port: one the system hands out, freed again for the server.
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') }), port = probe.port;
  await probe.stop(true);
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(['bun', 'server.ts', '--stub-github'], { cwd: resolve(import.meta.dir, '..'), stdout: 'ignore', stderr: 'ignore',
    env: { ...process.env, DB: file, EGG_INBOX: join(dir, 'inbox'), HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test' } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not up yet */ } await Bun.sleep(100); }
  throw new Error('The test server did not start.');
}, 30_000);
// Only the process started above is stopped, by its own id.
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
const resumes = () => { const d = new Database(file, { readonly: true }); try { return d.query('SELECT id, resume, edited FROM jobs ORDER BY id').all(); } finally { d.close(); } };
const START = [{ id: 1, resume: OLD_RESUME, edited: 0 }, { id: 2, resume: SECOND, edited: 0 }];
const KEY = 'two-current:1:4';

test('a raised question is listed with its choices, and Talk does not list it', async () => {
  const q = await call('GET', '/questions');
  const mine = q.body.questions.find((x: { key: string }) => x.key === KEY);
  expect(mine).toMatchObject({ kind: 'timeline', about: 'role:1,role:4', inputs: ['month', 'month', 'line'] });
  expect(mine.choices.length).toBe(3);
  const talk = await call('GET', '/talk');
  expect(talk.body.questions.map((x: { text: string }) => x.text)).not.toContain(mine.text);
  expect(resumes()).toEqual(START);
});

test('Home’s list puts the raised question first with what it blocks, and a snooze hides it until its time', async () => {
  const first = await call('GET', '/queue');
  expect(first.body.items[0]).toMatchObject({ key: KEY, kind: 'timeline', blocks: 'Blocks 1 resume', inputs: ['month', 'month', 'line'], route: '' });
  expect(first.body.snoozed).toBe(0);
  expect(await call('POST', '/queue/snooze', { key: 'talk:nothing' })).toMatchObject({ status: 400, body: { error: 'That item no longer needs you.' } });
  expect(await call('POST', '/queue/snooze', { key: KEY, until: 'tomorrow' })).toMatchObject({ status: 400, body: { error: 'Choose a time later than now.' } });
  expect(await call('POST', '/queue/snooze', { key: KEY, until: Date.now() + 2000 })).toMatchObject({ status: 200, body: { ok: true } });
  const hidden = await call('GET', '/queue');
  expect(hidden.body.items.map((x: { key: string }) => x.key)).not.toContain(KEY);
  expect(hidden.body.snoozed).toBe(1);
  await Bun.sleep(2100);
  const back = await call('GET', '/queue');
  expect(back.body.snoozed).toBe(0);
  expect(back.body.items[0].key).toBe(KEY);
});

test('an answer that cannot be applied is refused, and the question stays open', async () => {
  expect(await call('POST', '/questions', { key: KEY, choice: 0, value: 'soon' })).toMatchObject({ status: 400, body: { error: 'Give the end date as a year and a month, like 2023-06.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 0, value: '2019-01' })).toMatchObject({ status: 400, body: { error: 'That end date is before the job’s start date.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'x'.repeat(201) })).toMatchObject({ status: 400 });
  expect(await call('POST', '/questions', { key: KEY, choice: 7 })).toMatchObject({ status: 400, body: { error: 'Choose one of the listed answers.' } });
  expect((await call('GET', '/questions')).body.questions.map((x: { key: string }) => x.key)).toContain(KEY);
});

test('a timeline answer changes the role, closes the question, and changes no stored resume', async () => {
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'My own studio, run on weekends beside the Harborlight job.' })).toMatchObject({ status: 200, body: { ok: true } });
  expect(resumes()).toEqual(START);
  expect((await call('GET', '/questions')).body.questions.map((x: { key: string }) => x.key)).not.toContain(KEY);
  const role = (await call('GET', '/bank')).body.places.length;
  expect(role).toBeGreaterThan(0);
  // A second answer to the same question is refused: an answer is applied once.
  expect((await call('POST', '/questions', { key: KEY, choice: 1, value: '2024-01' })).status).toBe(400);
  const d = new Database(file, { readonly: true });
  expect(d.query('SELECT end, note FROM roles WHERE id = 4').get()).toEqual({ end: '', note: 'My own studio, run on weekends beside the Harborlight job.' });
  d.close();
});

test('one mark with no "reviewed" is not a review, and changes no stored resume', async () => {
  const marked = await call('POST', '/skills', { marks: [{ name: 'TypeScript', mark: 'not-confident' }] });
  expect(marked).toMatchObject({ status: 200, body: { ok: true, marked: 1, reviewed: false, updated: 0 } });
  expect(resumes()).toEqual(START);
  const list = (await call('GET', '/skills')).body;
  expect(list.reviewed).toBe(false);
  expect(list.skills.find((s: { name: string }) => s.name === 'Go')).toMatchObject({ mark: '', shown: true });
  expect(list.skills.find((s: { name: string }) => s.name === 'TypeScript')).toMatchObject({ mark: 'not-confident', shown: false });
});

test('a review is refused while no skill is marked confident, and then rewrites only the Skills line of written resumes', async () => {
  const refused = await call('POST', '/skills', { marks: [], reviewed: true });
  expect(refused).toMatchObject({ status: 400, body: { error: 'Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.' } });
  expect((await call('GET', '/skills')).body.reviewed).toBe(false);
  expect(resumes()).toEqual(START);
  const done = await call('POST', '/skills', { marks: [{ name: 'Go', mark: 'confident' }], reviewed: true });
  expect(done).toMatchObject({ status: 200, body: { ok: true, marked: 1, reviewed: true, updated: 2 } });
  const now = resumes() as { id: number; resume: string }[];
  expect(now[1].resume).toBe(SECOND.replace('## Skills\nGo, TypeScript, synergy', '## Skills\n\nGo'));
  expect(now[0].resume.split('## Skills')[0]).toBe(OLD_RESUME.split('## Skills')[0]);
});

test('a hand edit is stored with plain line endings, and is then left alone', async () => {
  const mine = '# Avery Lindqvist\r\n\r\n## Experience\r\n### Senior Engineer, Quillfeather Labs\r\nJan 2016 – Feb 2021\r\n- Rebuilt the quoting API.\r\n\r\n## Skills\r\nGo, synergy\r\n';
  expect((await call('PATCH', '/jobs/2', { resume: mine })).status).toBe(200);
  const stored = (resumes() as { id: number; resume: string; edited: number }[])[1];
  expect(stored).toEqual({ id: 2, resume: mine.replace(/\r\n/g, '\n').trim(), edited: 1 });
  const job = (await call('GET', '/jobs/2')).body;
  // Its bullet is read, and what is wrong with it is a flag, not a rewrite.
  expect(job.flags.map((f: { kind: string }) => f.kind)).toContain('skills-other');
  expect(job.flags.map((f: { kind: string }) => f.kind)).not.toContain('zero-bullets');
  await call('POST', '/skills', { marks: [{ name: 'TypeScript', mark: 'confident' }] });
  expect((resumes() as { resume: string }[])[1].resume).toBe(stored.resume);
});
