// `bun test lib`: the new routes, asked over HTTP of a real `server.ts` that runs on a throw-away database made
// with the old schema (lib/oldschema.ts). The server is started here on a spare local port and is stopped by its
// own process id. It never prints a PDF (--stub-github) and never asks a model. Everything in the database is invented.
// What it proves: answering a raised question, or marking a skill, changes no stored resume by itself; a raised
// question stays open until it is answered here; a review of the skills list needs to be asked for, and can be refused.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';
import { OLD_RESUME, oldDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-routes-')), file = join(dir, 'egg.db');
const SECOND = '# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n\n## Skills\nGo, TypeScript, synergy';
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
// A test that runs past its time is stopped, and the server it started with it, which fails every test after it. On a
// machine busy with another test run the requests take longer: each test has a minute.
setDefaultTimeout(60_000);

beforeAll(async () => {
  oldDatabase(file);
  const d = new Database(file);
  // Two unsent resumes that a model wrote (edited = 0), and a second current job so the timeline has something to ask.
  d.run('UPDATE jobs SET edited = 0');
  d.query("INSERT INTO jobs (id, posting, title, company, status, fit, analysis, resume, created_at, edited, outcome) VALUES (2, 'A posting about Go and TypeScript.', 'Engineer', 'Nimbus Yard', 'done', 50, ?, ?, 2, 0, '')")
    .run(JSON.stringify({ verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] }), SECOND);
  d.run("INSERT INTO roles (id, company, title, start, end, standing) VALUES (4, 'Lantern Notes', 'Founder', '2023-06', '', 'own')");
  d.close();
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
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

// The words of a choice as the screen shows it now, which every answer sends with the choice's place.
const said = async (key: string, choice: number) => ((await call('GET', '/questions')).body.questions.find((x: { key: string }) => x.key === key)?.choices ?? [])[choice];

test('an answer that cannot be applied is refused, and the question stays open', async () => {
  // An answer that does not say the words of the choice it means, or whose words are not that choice now, is refused.
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'A line.' })).toMatchObject({ status: 400, body: { error: 'Say which answer you chose, in its words.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'A line.', text: await said(KEY, 1) })).toMatchObject({ status: 400, body: { error: 'This question changed. Look at it again.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 0, value: 'soon', text: await said(KEY, 0) })).toMatchObject({ status: 400, body: { error: 'Give the end date as a year and a month, like 2023-06.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 0, value: '2019-01', text: await said(KEY, 0) })).toMatchObject({ status: 400, body: { error: 'That end date is before the job’s start date.' } });
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'x'.repeat(201), text: await said(KEY, 2) })).toMatchObject({ status: 400 });
  expect(await call('POST', '/questions', { key: KEY, choice: 7 })).toMatchObject({ status: 400, body: { error: 'Choose one of the listed answers.' } });
  expect((await call('GET', '/questions')).body.questions.map((x: { key: string }) => x.key)).toContain(KEY);
});

test('a timeline answer changes the role, closes the question, and changes no stored resume', async () => {
  expect(await call('POST', '/questions', { key: KEY, choice: 2, value: 'My own studio, run on weekends beside the Harborlight job.', text: await said(KEY, 2) })).toMatchObject({ status: 200, body: { ok: true } });
  expect(resumes()).toEqual(START);
  expect((await call('GET', '/questions')).body.questions.map((x: { key: string }) => x.key)).not.toContain(KEY);
  const role = (await call('GET', '/bank')).body.places.length;
  expect(role).toBeGreaterThan(0);
  // A second answer to the same question is refused: an answer is applied once.
  expect((await call('POST', '/questions', { key: KEY, choice: 1, value: '2024-01', text: 'Both are current: write one line that says how they relate' })).status).toBe(400);
  const d = new Database(file, { readonly: true });
  expect(d.query('SELECT end, note FROM roles WHERE id = 4').get()).toEqual({ end: '', note: 'My own studio, run on weekends beside the Harborlight job.' });
  d.close();
});

test('one mark with no "reviewed" is not a review, and changes no stored resume', async () => {
  const marked = await call('POST', '/skills', { marks: [{ name: 'TypeScript', mark: 'not-confident' }] });
  expect(marked).toMatchObject({ status: 200, body: { ok: true, marked: 1, reviewed: false, due: false } });
  expect(resumes()).toEqual(START);
  const list = (await call('GET', '/skills')).body;
  expect(list.reviewed).toBe(false);
  expect(list.skills.find((s: { name: string }) => s.name === 'Go')).toMatchObject({ mark: '', shown: true });
  expect(list.skills.find((s: { name: string }) => s.name === 'TypeScript')).toMatchObject({ mark: 'not-confident', shown: false });
});

test('a review is refused while no skill is marked confident; then, once the sitting is over, only the Skills line of written resumes is written again', async () => {
  const refused = await call('POST', '/skills', { marks: [], reviewed: true });
  expect(refused).toMatchObject({ status: 400, body: { error: 'Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.' } });
  expect((await call('GET', '/skills')).body.reviewed).toBe(false);
  expect(resumes()).toEqual(START);
  const done = await call('POST', '/skills', { marks: [{ name: 'Go', mark: 'confident' }], reviewed: true });
  expect(done).toMatchObject({ status: 200, body: { ok: true, marked: 1, reviewed: true, due: true } });
  // The review only makes the Skills lines due; the worker writes them once the sitting is over (here, at once).
  expect(resumes()).toEqual(START);
  expect((await call('GET', '/skills')).body.due).toBe(true);
  expect((await call('POST', '/test/skills-due')).body).toEqual({ ok: true, written: [1, 2] });
  expect((await call('GET', '/skills')).body.due).toBe(false);
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

// The record as a tree, over HTTP. These come last: they change roles, and so the record's signature (never a stored
// resume: no worker runs here).
test('the tree lists roles, projects and facts with references, and no story or evidence', async () => {
  const t = (await call('GET', '/tree')).body;
  expect(t.roles.map((r: { ref: string }) => r.ref)).toEqual(['R-04', 'R-01', 'R-02']);
  expect(t.projects).toEqual([expect.objectContaining({ ref: 'P-001', place: 'role', roleId: '1', title: 'harborlight/dispatch', carried: true })]);
  expect(t.facts).toEqual([{ id: '1', ref: 'F-0001', roleId: '1', projectId: '', text: 'Built the dispatch console.', metric: '640 users', kind: 'accomplishment' },
    { id: '2', ref: 'F-0002', roleId: '2', projectId: '', text: 'Rebuilt the quoting API.', metric: '', kind: 'project' }]);
  expect(t.counts).toEqual({ roles: 3, projects: 1, sides: 0, unplaced: 0, facts: 2 });
  const one = (await call('GET', '/facts/1')).body;
  expect(one).toMatchObject({ ref: 'F-0001', detail: 'The story.', skills: 'TypeScript, Go', source: 'Added by hand' });
  expect((await call('GET', '/facts/99')).status).toBe(404);
});

test('the bank the old screens read is unchanged', async () => {
  const b = (await call('GET', '/bank')).body;
  expect(Object.keys(b)).toEqual(['roles', 'places', 'facts']);
  expect(Object.keys(b.facts[0])).toEqual(['id', 'roleId', 'kind', 'text', 'detail', 'metric', 'skills', 'evidence', 'source', 'added', 'edited']);
  expect(Object.keys(b.roles[0])).toEqual(['id', 'name', 'period', 'standing', 'reach', 'employer', 'partOf', 'partOfName', 'start', 'end', 'note', 'label']);
  expect(b.places.map((p: { name: string }) => p.name)).toContain('General (no role)');
});

test('a project and a fact go to a role made on the spot, which must read title at employer', async () => {
  const stored = resumes();
  expect(await call('POST', '/projects', { title: 'Platform rewrite', newRole: 'Fernway' })).toMatchObject({ status: 400, body: { error: 'Name the new role as title at employer, or pick one from the list.' } });
  const p = await call('POST', '/projects', { title: 'Platform rewrite', newRole: 'Head of Platform at Fernway', when: '2024–2025', result: 'One platform.' });
  expect(p).toMatchObject({ status: 201, body: { ok: true, kind: 'project', ref: 'P-002', madeRole: '5' } });
  const f = await call('POST', '/facts', { text: 'Moved 40 services.', projectId: p.body.id });
  expect(f).toMatchObject({ status: 201, body: { ok: true, kind: 'fact', id: '3', ref: 'F-0003' } });
  const t = (await call('GET', '/tree')).body;
  expect(t.roles.find((r: { id: string }) => r.id === '5')).toMatchObject({ title: 'Head of Platform', company: 'Fernway', marks: { company: 'memory', title: 'memory' } });
  expect(t.facts.find((x: { id: string }) => x.id === '3')).toMatchObject({ roleId: '5', projectId: p.body.id });
  // A partial edit keeps the rest; the project goes and its fact stays, in Day to day.
  expect((await call('PATCH', '/facts/1', { metric: '650 users' })).status).toBe(200);
  expect((await call('GET', '/facts/1')).body).toMatchObject({ text: 'Built the dispatch console.', detail: 'The story.', metric: '650 users' });
  expect((await call('DELETE', `/projects/${p.body.id}`)).status).toBe(200);
  expect((await call('GET', '/tree')).body.facts.find((x: { id: string }) => x.id === '3')).toMatchObject({ roleId: '5', projectId: '' });
  // No stored resume changed: writing them again is the worker's, after the record has been still for a while.
  expect(resumes()).toEqual(stored);
});

// Stage 2 over HTTP: the record's questions, "How you work", and suggested projects, each refusing bad input in words.
test('the record’s questions are listed with what each choice needs, and the tree carries them', async () => {
  const q = (await call('GET', '/questions')).body.questions.filter((x: { kind: string }) => x.kind === 'record');
  const start = q.find((x: { key: string }) => x.key.startsWith('record:start:'));
  if (start) expect(start.inputs).toEqual(['month', '']);
  const t = (await call('GET', '/tree')).body;
  expect(Array.isArray(t.questions)).toBe(true);
  expect(t.questions.every((x: { key: string; route: string }) => x.key.startsWith('record:') && x.route.startsWith('/record'))).toBe(true);
  expect(Array.isArray(t.derived)).toBe(true);
});

test('a verdict on a line that does not hold, a suggestion request on a small role, and a bad suggestion are refused in words', async () => {
  expect(await call('POST', '/derived/nothing:here', { verdict: 'kept' })).toMatchObject({ status: 400, body: { error: 'That line no longer holds for your record.' } });
  expect(await call('POST', '/derived/nothing:here', { verdict: 7 })).toMatchObject({ status: 400, body: { error: 'Say kept, rejected, or nothing to take a verdict back.' } });
  expect(await call('POST', '/roles/1/propose')).toMatchObject({ status: 409, body: { error: 'Suggestions need at least 6 facts in this role’s Day to day.' } });
  expect(await call('POST', '/roles/999/propose')).toMatchObject({ status: 409, body: { error: 'That role is no longer in your record.' } });
  expect(await call('POST', '/roles/abc/propose')).toMatchObject({ status: 409 });
  expect(await call('POST', '/proposals/abc', { keep: true })).toMatchObject({ status: 404 });
  expect(await call('POST', '/proposals/999', { keep: true })).toMatchObject({ status: 404, body: { error: 'That suggestion is no longer there.' } });
  expect(await call('POST', '/proposals/999', {})).toMatchObject({ status: 400, body: { error: 'Say keep, reject, or what to do with the result.' } });
  expect((await call('GET', '/roles/1/proposals')).body).toEqual({ proposals: [] });
});

test('suggestions asked for on a role with 6 facts in Day to day: stored through the checks, and kept with each fact in its role', async () => {
  const facts: string[] = [];
  for (let i = 0; i < 6; i++) facts.push((await call('POST', '/facts', { roleId: 2, text: `Ran the invented review number ${i}.` })).body.id);
  expect(await call('POST', '/roles/2/propose')).toMatchObject({ status: 200 });
  expect(await call('POST', '/roles/2/propose')).toMatchObject({ status: 409, body: { error: 'Projects are being suggested for this role now.' } });
  const a = (await call('GET', '/activity')).body.items.find((i: { kind: string }) => i.kind === 'propose-projects');
  expect(a).toMatchObject({ subject: '2', status: 'waiting', link: '/record/role/2' });
  expect((await call('POST', '/test/proposals', { roleId: 2, projects: [{ title: 'Review rounds', facts: [`fact:${facts[0]}`, `fact:${facts[1]}`], result: '' }, { title: 'Invented', facts: ['fact:9999', `fact:${facts[2]}`], result: '' }] })).body).toEqual({ ok: true, stored: 1 });
  const [p] = (await call('GET', '/roles/2/proposals')).body.proposals;
  expect(p).toMatchObject({ title: 'Review rounds', status: 'open' });
  expect((await call('GET', '/queue')).body.items.some((i: { key: string }) => i.key === 'proposals:2')).toBe(true);
  const d = new Database(file, { readonly: true });
  const before = d.query('SELECT id, role_id FROM facts ORDER BY id').all();
  d.close();
  expect(await call('POST', `/proposals/${p.id}`, { keep: true, title: 'x'.repeat(201) })).toMatchObject({ status: 400 });
  expect(await call('POST', `/proposals/${p.id}`, { keep: true })).toMatchObject({ status: 200, body: { ok: true } });
  const e = new Database(file, { readonly: true });
  expect(e.query('SELECT id, role_id FROM facts ORDER BY id').all()).toEqual(before);
  e.close();
  expect((await call('GET', '/queue')).body.items.some((i: { key: string }) => i.key === 'proposals:2')).toBe(false);
});

test('adding, moving and deleting a fact checks the record’s questions again at once', async () => {
  const r = await call('POST', '/roles', { title: 'Analyst', company: 'Corbel Yard', start: '2019-03' });
  expect(r.status).toBe(201);
  const empty = `record:empty:${r.body.id}`;
  const open = async () => ((await call('GET', '/tree')).body.questions as { key: string }[]).some((q) => q.key === empty);
  expect(await open()).toBe(true);
  const f = await call('POST', '/facts', { roleId: Number(r.body.id), text: 'Wrote the invented weekly report.' });
  expect(f.status).toBe(201);
  expect(await open()).toBe(false);
  // Moved to another role, the role is empty again; moved back, it is not.
  expect((await call('PATCH', `/facts/${f.body.id}`, { roleId: 4 })).status).toBe(200);
  expect(await open()).toBe(true);
  expect((await call('PATCH', `/facts/${f.body.id}`, { roleId: Number(r.body.id) })).status).toBe(200);
  expect(await open()).toBe(false);
  expect((await call('DELETE', `/facts/${f.body.id}`)).status).toBe(200);
  expect(await open()).toBe(true);
});

test('the new routes refuse a body that is not a JSON object, and a line name that cannot be read, in words', async () => {
  const raw = async (method: string, path: string, body: string) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
  for (const path of ['/proposals/1', '/derived/results', '/roles/2/propose'])
    for (const body of ['null', '[]', '[1, 2]', '"keep"', '7'])
      expect(await raw('POST', path, body)).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('POST', '/derived/%E0%A4%A', { verdict: 'kept' })).toEqual({ status: 400, body: { error: 'That line’s name could not be read.' } });
  // A name with a % in it is read once, as sent.
  expect(await call('POST', `/derived/${encodeURIComponent('learned:cut 20%')}`, { verdict: 'kept' })).toMatchObject({ status: 400, body: { error: 'That line no longer holds for your record.' } });
  // A good body is read as before.
  expect(await call('POST', '/derived/nothing:here', { verdict: 'kept' })).toMatchObject({ status: 400, body: { error: 'That line no longer holds for your record.' } });
});

test('Activity’s Try again on failed project suggestions asks again by the role’s own path', async () => {
  for (let i = 0; i < 2; i++) await call('POST', '/facts', { roleId: 2, text: `Ran the invented audit number ${i}.` });
  expect((await call('POST', '/test/work', { kind: 'propose-projects', id: 2, to: 'failed', note: 'The model did not answer.' })).body).toEqual({ ok: true });
  const failed = (await call('GET', '/activity')).body.items.find((i: { kind: string; subject: string }) => i.kind === 'propose-projects' && i.subject === '2');
  expect(failed).toMatchObject({ status: 'failed' });
  expect(await call('POST', `/activity/${failed.id}/retry`)).toEqual({ status: 200, body: { ok: true } });
  const d = new Database(file, { readonly: true });
  expect(d.query('SELECT propose_status, propose_note FROM roles WHERE id = 2').get()).toEqual({ propose_status: 'queued', propose_note: '' });
  d.close();
  expect(await call('POST', `/activity/${failed.id}/retry`)).toMatchObject({ status: 404 });
});

test('the Skills screen\'s list over HTTP: its groups and counts, a new skill, a mark through Home’s question, and the review', async () => {
  const before = (await call('GET', '/skills')).body;
  expect(Array.isArray(before.groups)).toBe(true);
  const all = before.groups.flatMap((g: { skills: { name: string }[] }) => g.skills);
  expect(all.length).toBe(before.skills.length);
  const go = all.find((s: { key: string }) => s.key === 'go');
  expect([go.name, go.kind, typeof go.facts, typeof go.roles, go.factList.length === go.facts]).toEqual(['Go', 'language', 'number', 'number', true]);
  // An earlier test reviewed the list. A skill the record gains after it is new, first, and asked about on Home; a tap on
  // it from the list answers that question; the same tap again changes nothing.
  expect((await call('POST', '/facts', { roleId: 1, text: 'Ran the invented queue.', skills: 'Zephyrqueue' })).status).toBe(201);
  const fresh = (await call('GET', '/skills')).body;
  expect(fresh.groups[0]).toMatchObject({ id: 'new', title: 'New since your last review' });
  expect(fresh.groups[0].skills.map((x: { name: string; question: boolean }) => [x.name, x.question])).toEqual([['Zephyrqueue', true]]);
  expect(await call('POST', '/skills', { marks: [{ name: 'Zephyrqueue', mark: 'not-confident' }] })).toMatchObject({ status: 200, body: { ok: true, marked: 1 } });
  expect((await call('GET', '/questions')).body.questions.some((q: { key: string }) => q.key === 'skill:zephyrqueue')).toBe(false);
  expect(await call('POST', '/skills', { marks: [{ name: 'Zephyrqueue', mark: 'not-confident' }] })).toMatchObject({ status: 200, body: { ok: true, marked: 0 } });
  expect(await call('POST', '/skills', { marks: [], reviewed: true })).toMatchObject({ status: 200, body: { ok: true, reviewed: true } });
  const after = (await call('GET', '/skills')).body;
  expect([after.reviewed, after.newCount, /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(after.reviewedOn)]).toEqual([true, 0, true]);
});

test('POST /skills refuses a body that is not an object, skips entries that are not marks, and an empty mark clears nothing', async () => {
  const raw = async (body: string) => { const r = await fetch(`${base}/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
  expect(await raw('null')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await raw('[1]')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await call('POST', '/skills', { marks: [null, 7, 'Go'] })).toMatchObject({ status: 200, body: { ok: true, marked: 0 } });
  const goMark = async () => ((await call('GET', '/skills')).body.skills as { name: string; mark: string }[]).find((x) => x.name === 'Go')!.mark;
  const was = await goMark();
  expect(was).not.toBe('');
  expect(await call('POST', '/skills', { marks: [{ name: 'Go', mark: '' }] })).toMatchObject({ status: 200, body: { marked: 0 } });
  expect(await goMark()).toBe(was);
});

test('while the Skills lines wait for the quiet, the PDF asked for and the job marked sent take the list as it is now', async () => {
  const d = () => new Database(file, { readonly: true });
  const line = (id: number) => { const x = d(); try { return ((x.query('SELECT resume FROM jobs WHERE id = ?').get(id) as { resume: string }).resume.split('## Skills')[1] ?? '').trim(); } finally { x.close(); } };
  // Go stays confident through TypeScript; Go is then said Not confident. Job 1 is unsent and not edited.
  expect(await call('POST', '/skills', { marks: [{ name: 'TypeScript', mark: 'confident' }, { name: 'Go', mark: 'not-confident' }] })).toMatchObject({ status: 200, body: { ok: true, due: true } });
  expect(line(1)).toContain('Go');
  expect((await call('GET', '/jobs/1')).body.skillsLine).toBe('Your skills list changed. This resume gets the new list in about 2 minutes, or when you open its PDF.');
  const pdf = await fetch(`${base}/jobs/1/resume.pdf`);
  expect(pdf.status).toBe(200);
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await pdf.arrayBuffer())), { mergePages: true });
  const skills = String(text).split('Skills').pop()!;
  expect(skills).toContain('TypeScript');
  expect(skills).not.toMatch(/\bGo\b/);
  expect(line(1)).toBe('TypeScript');
  expect((await call('GET', '/jobs/1')).body.skillsLine).toBe('');
  // Go is confident again; the job is marked applied at once, and goes out with the list as it is now.
  expect(await call('POST', '/skills', { marks: [{ name: 'Go', mark: 'confident' }] })).toMatchObject({ status: 200, body: { due: true } });
  expect((await call('PATCH', '/jobs/1', { outcome: 'applied', picked: true })).status).toBe(200);
  expect(line(1)).toMatch(/\bGo\b/);
}, 120_000);

test('a job with broken stored data, while the Skills lines are due: its outcome is still recorded, and its stored PDF still served', async () => {
  const pdfFile = join(dir, 'invented.pdf');
  await Bun.write(pdfFile, '%PDF-1.4 invented');
  const w = new Database(file);
  const id = (w.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, resume_status, created_at, edited, outcome, pdf) VALUES ('Go.', 'Engineer', 'Nimbus Yard', 'done', '{not json', ?, 'done', 1, 0, '', ?) RETURNING id")
    .get('# Avery Lindqvist\n\n## Experience\n### Director of Engineering, Harborlight Systems\n- Built it.\n\n## Skills\n\nGo, Kafka', pdfFile) as { id: number }).id;
  w.close();
  expect(await call('POST', '/skills', { marks: [{ name: 'Go', mark: 'not-confident' }] })).toMatchObject({ status: 200, body: { due: true } });
  const pdf = await fetch(`${base}/jobs/${id}/resume.pdf`);
  expect([pdf.status, await pdf.text()]).toEqual([200, '%PDF-1.4 invented']);
  expect((await call('PATCH', `/jobs/${id}`, { outcome: 'applied', picked: true })).status).toBe(200);
  const r = new Database(file, { readonly: true });
  expect(r.query('SELECT outcome FROM jobs WHERE id = ?').get(id)).toEqual({ outcome: 'applied' });
  r.close();
});
