// `bun test lib`: the You screen over HTTP (lib/you.ts, lib/nextquestion.ts, lib/agenda.ts), on a real `server.ts`
// (--stub-github: no PDF, no model) and a throw-away database. GET /you gives what stands out, the next question and the
// counts; an answer in words reaches Talk and closes the question; a skip closes it; the owner's line is kept; GET /told
// gives the whole document; the agenda's questions stay off Home and off GET /questions. Everything is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-you-routes-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
setDefaultTimeout(60_000);

beforeAll(async () => {
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
const write = (sql: string, ...args: (string | number)[]) => { const d = new Database(file); try { d.query(sql).run(...args); } finally { d.close(); } };
const read = <T>(sql: string, ...args: (string | number)[]) => { const d = new Database(file, { readonly: true }); try { return d.query(sql).all(...args) as T[]; } finally { d.close(); } };
const reading = JSON.stringify({ verdict: '', requirements: [{ text: 'Kubernetes pipelines in production', need: 'must', coverage: 'none', evidence: '' }], strengths: [], risks: [], changes: [], gaps: [] });

let project = '';
test('GET /you: what stands out, the next question from two saved postings, and the counts', async () => {
  const role = (await call('POST', '/roles', { title: 'Head of Platform', company: 'Fernway', start: '2022-01' })).body.id;
  project = (await call('POST', '/projects', { title: 'Depot rota console', roleId: role })).body.id;
  expect((await call('PATCH', `/projects/${project}`, { context: 'Paper rotas.', action: 'Wrote it.', result: 'No more paper.' })).status).toBe(200);
  expect((await call('POST', '/facts', { text: 'Built the depot rota console.', roleId: role, projectId: project })).status).toBeLessThan(300);
  for (let i = 0; i < 2; i++) write("INSERT INTO jobs (posting, title, company, status, analysis, terms_raw, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Nimbus Yard', 'done', ?, '[\"Kubernetes\"]', 1, '')", reading);
  const you = (await call('GET', '/you')).body;
  expect(you.standsOut).toEqual([{ place: 1, factId: expect.any(String), projectId: project, projectTitle: 'Depot rota console', text: 'Built the depot rota console.', metric: '', edited: false, hasRecordLine: true }]);
  expect(you.next).toEqual({ key: 'agenda:term:kubernetes', text: '2 postings you saved ask for Kubernetes, and your record has no story that shows it. Tell one time you worked with it, or say you have not.',
    from: '2 saved postings ask for this', kind: 'agenda', input: 'text', choices: [], inputs: [], route: '' });
  expect(you.open).toBe(1);
  expect(you.told).toEqual({ roles: 1, projects: 1, facts: 1, withWords: 0 });
  // Not on Home, and not among the questions answered by a choice.
  expect((await call('GET', '/queue')).body.items.map((i: { key: string }) => i.key)).not.toContain('agenda:term:kubernetes');
  expect((await call('GET', '/questions')).body.questions.map((q: { key: string }) => q.key)).not.toContain('agenda:term:kubernetes');
});

test('POST /you/answer puts the words in Talk and closes the question; a second answer waits for Talk', async () => {
  expect(await call('POST', '/you/answer', { key: 'agenda:term:kubernetes' })).toEqual({ status: 400, body: { error: 'Write your answer, or skip the question.' } });
  expect(await call('POST', '/you/answer', '[1]')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('POST', '/you/answer', { key: 'agenda:term:kubernetes', words: 'I ran quote events through Kubernetes at Fernway.' })).toEqual({ status: 200, body: { ok: true } });
  expect(read('SELECT who, body, status FROM talk ORDER BY id')).toEqual([
    { who: 'claude', body: '2 postings you saved ask for Kubernetes, and your record has no story that shows it. Tell one time you worked with it, or say you have not.', status: 'done' },
    { who: 'you', body: 'I ran quote events through Kubernetes at Fernway.', status: 'done' }, { who: 'claude', body: '', status: 'queued' }]);
  const you = (await call('GET', '/you')).body;
  expect(you).toMatchObject({ next: null, open: 0 });
  expect(await call('POST', '/you/answer', { key: 'agenda:term:kubernetes', words: 'Again.' })).toEqual({ status: 400, body: { error: 'That question is no longer open.' } });
  // A model-written question, while the reply is still queued: accepted and kept for later.
  write("INSERT INTO jobs (posting, title, company, status, analysis, created_at, outcome) VALUES ('A posting.', 'Staff Engineer', 'Initech', 'done', ?, 1, '')", JSON.stringify({ gaps: ['How many depots used the rota?'] }));
  const q = (await call('GET', '/you')).body.next;
  expect(q).toMatchObject({ kind: 'talk', text: 'How many depots used the rota?', from: 'For Staff Engineer at Initech', input: 'text' });
  expect(await call('POST', '/you/answer', { key: q.key, words: 'Twelve.' })).toEqual({ status: 200, body: { ok: true } });
  expect(await call('POST', '/you/skip', { key: 'nothing' })).toEqual({ status: 400, body: { error: 'That question is no longer open.' } });
  expect(await call('POST', '/you/skip', { key: q.key })).toEqual({ status: 400, body: { error: 'That question is no longer open.' } });
  expect((await call('GET', '/you')).body.waiting).toBe(1);
  expect((await call('GET', '/you')).body).toMatchObject({ next: null, open: 0 });
});

test('the owner’s line, leaving out and restoring, and GET /told', async () => {
  expect(await call('POST', '/you/stands-out', { projectId: project, text: '' })).toEqual({ status: 400, body: { error: 'Write the line, or leave the project out.' } });
  expect(await call('POST', '/you/stands-out', { projectId: 'x', text: 'Words.' })).toEqual({ status: 400, body: { error: 'That project is not in the record.' } });
  expect(await call('POST', '/you/stands-out', { projectId: project, text: 'Took twelve depots off paper.' })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', '/you')).body.standsOut).toMatchObject([{ text: 'Took twelve depots off paper.', edited: true }]);
  expect((await call('GET', '/you')).body.leftOut).toEqual([]);
  expect(await call('POST', '/you/stands-out/leave-out', { projectId: Number(project) })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', '/you')).body).toMatchObject({ standsOut: [], leftOut: [{ projectId: project, projectTitle: 'Depot rota console', hasOwnLine: true }] });
  // Bringing back a project twice keeps the owner's words.
  for (let i = 0; i < 2; i++) expect(await call('POST', '/you/stands-out/bring-back', { projectId: project })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', '/you')).body).toMatchObject({ standsOut: [{ text: 'Took twelve depots off paper.', edited: true }], leftOut: [] });
  for (let i = 0; i < 2; i++) expect(await call('POST', '/you/stands-out/restore', { projectId: project })).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', '/you')).body.standsOut).toMatchObject([{ text: 'Built the depot rota console.', edited: false }]);
  const t = (await call('GET', '/told')).body;
  expect(t.roles).toMatchObject([{ title: 'Head of Platform', company: 'Fernway', projects: [{ title: 'Depot rota console',
    parts: [{ name: 'Context', text: 'Paper rotas.' }, { name: 'Action', text: 'Wrote it.' }, { name: 'Result', text: 'No more paper.' }], facts: [{ text: 'Built the depot rota console.', origins: [] }] }], facts: [] }]);
  expect(t).toMatchObject({ sides: [], unplaced: [], general: [], counts: { roles: 1, projects: 1, facts: 1, withWords: 0 } });
});

test('the counts GET /you gives are the counts of GET /told, with a kept fact and a kept project', async () => {
  const role = (await call('POST', '/roles', { title: 'Platform Lead', company: 'Lantern Notes', start: '2019-01', end: '2021-12' })).body.id;
  const secret = (await call('POST', '/projects', { title: 'Client work under NDA', roleId: role })).body.id;
  const open = (await call('POST', '/projects', { title: 'Release train', roleId: role })).body.id;
  for (const [text, p] of [['Ran the client build.', secret], ['Shipped every two weeks.', open], ['Named the client in a talk.', open]] as const)
    expect((await call('POST', '/facts', { text, roleId: role, projectId: p })).status).toBeLessThan(300);
  const said = read<{ id: number }>("SELECT id FROM facts WHERE text = 'Named the client in a talk.'")[0].id;
  // The marks, as the owner sets them (lib/standing.ts): one fact kept, one project kept.
  write("INSERT INTO fact_standing (fact_id, mark, marked_by) VALUES (?, 'kept', 'owner')", said);
  write("INSERT INTO project_standing (project_id, mark) VALUES (?, 'kept')", Number(secret));
  const counts = (await call('GET', '/you')).body.told, t = (await call('GET', '/told')).body;
  expect(counts).toEqual(t.counts);
  expect(t.counts).toEqual({ roles: 2, projects: 2, facts: 2, withWords: 0 });
  expect(JSON.stringify(t)).not.toContain('client');
});

test('an answer over 20,000 characters is refused in words', async () => {
  write("INSERT INTO jobs (posting, title, company, status, analysis, created_at, outcome) VALUES ('A posting.', 'Staff Engineer', 'Initech', 'done', ?, 1, '')", JSON.stringify({ gaps: ['What did the rota replace?'] }));
  const q = (await call('GET', '/you')).body.next;
  expect(await call('POST', '/you/answer', { key: q.key, words: 'a'.repeat(20_001) })).toEqual({ status: 400, body: { error: 'Keep your answer under 20,000 characters. Say the rest in Talk.' } });
});
