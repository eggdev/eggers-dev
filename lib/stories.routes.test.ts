// `bun test lib`: the spoken story and the Stories screen over HTTP (lib/spoken.ts, lib/stories.ts), on a real
// `server.ts` (--stub-github: no PDF, no model) and a throw-away database. Every new route answers, and every refusal
// comes back in words: asking for the spoken story, the stand-in for the worker writing it, a refused text failing in
// Activity and tried again, the owner's edit and "Replace my edit", practices, and questions from interviews at a job
// and at none. Everything is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-stories-routes-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
setDefaultTimeout(60_000);

beforeAll(async () => {
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
const read = <T>(sql: string, ...args: (string | number)[]) => { const d = new Database(file, { readonly: true }); try { return d.query(sql).all(...args) as T[]; } finally { d.close(); } };

let project = '', bare = '', job = '';
const SPOKEN = 'The schedulers planned the depots on paper every Sunday.\n\nI wrote the scheduler myself and moved the depots over in turn.';

test('the spoken story is refused with nothing to tell, asked for, written by the stand-in, and shown on the story with its time', async () => {
  const role = (await call('POST', '/roles', { title: 'Head of Platform', company: 'Fernway' })).body.id;
  project = (await call('POST', '/projects', { title: 'Depot rota console', roleId: role })).body.id;
  bare = (await call('POST', '/projects', { title: 'Hiring round', roleId: role })).body.id;
  expect(await call('POST', `/projects/${bare}/spoken`, {})).toEqual({ status: 409, body: { error: 'There is nothing to tell yet. Tell this project, or write its four parts, first.' } });
  expect(await call('POST', '/projects/99999/spoken', {})).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  expect((await call('PATCH', `/projects/${project}`, { context: 'Schedulers planned the depots on paper every Sunday.' })).status).toBe(200);
  expect(await call('POST', `/projects/${project}/spoken`, {})).toEqual({ status: 200, body: { ok: true } });
  expect(await call('POST', `/projects/${project}/spoken`, {})).toEqual({ status: 409, body: { error: 'The spoken story is being written now.' } });
  const a = (await call('GET', '/activity')).body;
  expect(a.items.find((i: { kind: string }) => i.kind === 'write-spoken')).toMatchObject({ subject: project, status: 'waiting', link: `/record/stories/${project}` });
  expect(await call('POST', '/test/spoken', { project, text: SPOKEN })).toEqual({ status: 200, body: { ok: true, status: 'done', note: '' } });
  const v = (await call('GET', `/stories/${project}`)).body;
  expect(v).toMatchObject({ id: project, title: 'Depot rota console', job: 'Head of Platform at Fernway', spoken: SPOKEN, held: false, status: 'done', canWrite: true,
    timeLine: 'About 10 s when spoken.', over: false, practiceLine: 'Not practised yet', practices: [], questions: [],
    parts: { context: 'Schedulers planned the depots on paper every Sunday.', action: '', result: '', learning: '' } });
  expect(await call('GET', '/stories/99999')).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  const l = (await call('GET', '/stories')).body;
  expect(l.groups).toEqual([{ key: `role:${role}`, name: 'Head of Platform at Fernway', stories: [{ id: project, ref: `P-${project.padStart(3, '0')}`, title: 'Depot rota console', line: '10 s · Not practised yet' }] }]);
  expect(l.untold).toBe(1);
});

test('a refused text fails in Activity with why, is not stored, and Try again asks for it again', async () => {
  expect(await call('POST', '/test/spoken', { project, text: 'Context:\nIt saved 40 hours.' })).toEqual({ status: 200, body: { ok: true, status: 'failed', note: 'The spoken story was not kept. It had a line that looks like a heading or a list: “Context:”.' } });
  expect(read<{ spoken: string }>('SELECT spoken FROM projects WHERE id = ?', Number(project))[0].spoken).toBe(SPOKEN);
  const failed = (await call('GET', '/activity')).body.items.find((i: { kind: string }) => i.kind === 'write-spoken');
  expect(failed).toMatchObject({ status: 'failed', reason: 'The spoken story was not kept. It had a line that looks like a heading or a list: “Context:”.' });
  expect(await call('POST', `/activity/${failed.id}/retry`, {})).toEqual({ status: 200, body: { ok: true } });
  expect(read<{ spoken_status: string }>('SELECT spoken_status FROM projects WHERE id = ?', Number(project))[0].spoken_status).toBe('queued');
  await call('POST', '/test/spoken', { project, text: SPOKEN });
});

test('the owner’s edit is saved and held; writing again is refused until Replace my edit', async () => {
  expect(await call('PATCH', `/projects/${project}/spoken`, [])).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('PATCH', `/projects/${project}/spoken`, { text: 3 })).toEqual({ status: 400, body: { error: 'Send the spoken story as text.' } });
  expect(await call('PATCH', '/projects/99999/spoken', { text: 'x' })).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  expect(await call('PATCH', `/projects/${project}/spoken`, { text: 'I wrote the scheduler myself.' })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', `/stories/${project}`)).body).toMatchObject({ spoken: 'I wrote the scheduler myself.', held: true });
  expect((await call('POST', `/projects/${project}/spoken`, {})).body.error).toBe('You changed this spoken story yourself, so writing it again would change nothing. Choose Replace my edit to have it written again.');
  expect(await call('POST', `/projects/${project}/spoken`, { replace: true })).toEqual({ status: 200, body: { ok: true } });
  await call('POST', '/test/spoken', { project, text: SPOKEN });
  expect((await call('GET', `/stories/${project}`)).body).toMatchObject({ spoken: SPOKEN, held: false });
});

test('practices are added, timed or not, refused in words, and deleted', async () => {
  expect(await call('POST', `/projects/${project}/practices`, {})).toEqual({ status: 201, body: { ok: true } });
  expect(await call('POST', `/projects/${project}/practices`, { seconds: 185 })).toEqual({ status: 201, body: { ok: true } });
  expect(await call('POST', `/projects/${project}/practices`, { seconds: -4 })).toEqual({ status: 400, body: { error: 'Send the time it took as a whole number of seconds.' } });
  expect(await call('POST', `/projects/${project}/practices`, '{not json')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('POST', '/projects/99999/practices', {})).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  const v = (await call('GET', `/stories/${project}`)).body;
  expect(v.timeLine).toBe('About 10 s when spoken. Last timed at 3 min 05 s.');
  expect(v.practices.map((p: { timed: string }) => p.timed)).toEqual(['3 min 05 s', '']);
  expect(v.practiceLine).toMatch(/^Practised 2 times, last on \d+ \w{3} \d{4}$/);
  expect(await call('DELETE', `/practices/${v.practices[0].id}`)).toEqual({ status: 200, body: { ok: true } });
  expect(await call('DELETE', `/practices/${v.practices[0].id}`)).toEqual({ status: 404, body: { error: 'That practice is no longer in your record.' } });
});

test('questions from interviews: added at a job and at none, listed on the job and on Stories, given a story, marked, deleted; Home follows', async () => {
  expect((await call('POST', '/jobs', { url: 'https://jobs.example.com/nimbus/lead', posting: '' })).status).toBe(201);
  job = String(read<{ id: number }>('SELECT max(id) AS id FROM jobs')[0].id);
  expect(await call('POST', '/interview-questions', { text: '' })).toEqual({ status: 400, body: { error: 'Write the question you were asked.' } });
  expect(await call('POST', '/interview-questions', { text: 'Why?', jobId: '99999' })).toEqual({ status: 404, body: { error: 'That job is no longer in your tracker.' } });
  expect(await call('POST', '/interview-questions', '[]')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  const a = (await call('POST', '/interview-questions', { text: 'Tell me about a plan you changed.', jobId: job })).body;
  const b = (await call('POST', '/interview-questions', { text: 'What would you do first?', jobId: '' })).body;
  expect([a.ok, b.ok]).toEqual([true, true]);
  expect((await call('GET', `/jobs/${job}/questions`)).body).toMatchObject({ questions: [{ id: a.id, text: 'Tell me about a plan you changed.', jobId: job, projectId: '', story: '', noStory: false }],
    choices: [{ id: project, label: 'Depot rota console (Head of Platform at Fernway)' }] });
  expect(await call('GET', '/jobs/99999/questions')).toEqual({ status: 404, body: { error: 'That job was deleted.' } });
  expect((await call('GET', '/stories')).body.questions.map((q: { text: string }) => q.text)).toEqual(['What would you do first?', 'Tell me about a plan you changed.']);
  const home = async () => (await call('GET', '/queue')).body.items.filter((i: { kind: string }) => i.kind === 'asked').map((i: { key: string }) => i.key);
  expect(await home()).toEqual([`asked:${b.id}`, `asked:${a.id}`]);
  expect(await call('PATCH', `/interview-questions/${a.id}`, { projectId: project })).toEqual({ status: 200, body: { ok: true } });
  expect(await call('PATCH', `/interview-questions/${b.id}`, { noStory: true })).toEqual({ status: 200, body: { ok: true } });
  expect(await home()).toEqual([]);
  expect((await call('GET', `/stories/${project}`)).body.questions).toEqual([{ id: a.id, text: 'Tell me about a plan you changed.', job: expect.any(String) }]);
  expect(await call('PATCH', `/interview-questions/${a.id}`, { projectId: '99999' })).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  expect(await call('PATCH', `/interview-questions/${a.id}`, {})).toEqual({ status: 400, body: { error: 'Say which story answers it, or that none is needed.' } });
  expect(await call('PATCH', `/interview-questions/${a.id}`, { projectId: true })).toEqual({ status: 400, body: { error: 'Say which story answers it, by its number.' } });
  expect(await call('PATCH', `/interview-questions/${a.id}`, { projectId: bare })).toEqual({ status: 400, body: { error: 'That piece of work has nothing told yet. Tell it first, then choose it.' } });
  expect(await call('POST', '/interview-questions', { text: 'tell me about a PLAN you changed.', jobId: job })).toEqual({ status: 409, body: { error: 'That question is in this job’s list already.' } });
  expect(await call('PATCH', '/interview-questions/99999', { noStory: true })).toEqual({ status: 404, body: { error: 'That question is no longer in your list.' } });
  expect(await call('DELETE', `/interview-questions/${b.id}`)).toEqual({ status: 200, body: { ok: true } });
  expect(await call('DELETE', `/interview-questions/${b.id}`)).toEqual({ status: 404, body: { error: 'That question is no longer in your list.' } });
  // Deleting the job keeps its question, with no job.
  expect((await call('DELETE', `/jobs/${job}`)).status).toBe(200);
  expect(read('SELECT job_id, project_id FROM interview_questions')).toEqual([{ job_id: null, project_id: Number(project) }]);
});
