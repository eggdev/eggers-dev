// `bun test lib`: telling a role or a project over HTTP (lib/capture.ts, lib/sittings.ts), on a real `server.ts`
// (--stub-github: no PDF, no model) and a throw-away database. A sitting is started or resumed on a role or a project,
// answered, stopped and read; one answer and one sitting are deleted; every refusal comes back in words, never as a
// crash. The owner's answer is read back from the database exactly as sent. The interviewer's words are the fixed ones.
// The server is stopped by its own process id. Everything is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';
import { CLOSING_DONE, CLOSING_PAUSED, OPENING, QUESTIONS, questionText, reminderText } from './capture.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-sittings-routes-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
setDefaultTimeout(60_000);

beforeAll(async () => {
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
}, 90_000);
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
const read = <T>(sql: string, ...args: (string | number)[]) => { const d = new Database(file, { readonly: true }); try { return d.query(sql).all(...args) as T[]; } finally { d.close(); } };
const q = (n: number) => questionText(QUESTIONS[n].key, 'role');
const lines = (said: { step: string; text: string }[]) => said.map((t) => [t.step, t.text]);
// The interviewer turn now waiting in a sitting, as the screen shows it, and an answer to it.
const waiting = async (sit: string) => String((await call('GET', `/sittings/${sit}`)).body.turns.at(-1).id);
const answer = async (sit: string, text: unknown) => call('POST', `/sittings/${sit}/answer`, { text, turn: await waiting(sit) });

let role = '', role2 = '', project = '', side = '';
// The answers here are in the first person and name no habit, so no follow-up comes between the questions.
const PICK = 'The move of the billing service to one cloud, in my second year.';

test('a role and a project are made; nothing is told yet; a role or project not in the record is refused in words', async () => {
  role = (await call('POST', '/roles', { title: 'Head of Platform', company: 'Fernway' })).body.id;
  role2 = (await call('POST', '/roles', { title: 'Staff Engineer', company: 'Quillfeather Labs' })).body.id;
  project = (await call('POST', '/projects', { title: 'Moved every service to one cloud', roleId: role })).body.id;
  const made = await call('POST', '/projects', { title: 'Built tidewater', side: true });
  expect(made.status).toBe(201);
  side = String(read<{ via_role: number }>('SELECT via_role FROM projects WHERE id = ?', Number(made.body.id))[0].via_role);
  expect(await call('GET', `/roles/${role}/sitting`)).toEqual({ status: 200, body: { kind: 'role', id: role, open: false, sitting: '', answered: 0, closed: 0, settled: 0, total: 15, lastAt: 0, lastOn: '' } });
  expect(await call('GET', '/roles/999/sitting')).toEqual({ status: 404, body: { error: 'That role is no longer in your record.' } });
  expect(await call('POST', '/projects/999/sitting')).toEqual({ status: 404, body: { error: 'That project is no longer in your record.' } });
  expect(await call('GET', '/roles/abc/sitting')).toEqual({ status: 404, body: { error: 'That role is no longer in your record.' } });
  expect(read('SELECT count(*) AS n FROM capture_sittings')).toEqual([{ n: 0 }]);
});

test('POST starts a sitting: the opening and the first question, in fixed words; again, the open one is given back', async () => {
  const first = await call('POST', `/roles/${role}/sitting`);
  expect(first.status).toBe(201);
  expect([first.body.ok, first.body.sitting, first.body.resumed, first.body.now, lines(first.body.said)]).toEqual([true, '1', false, 'waiting', [['opening', OPENING], ['question', q(0)]]]);
  const again = await call('POST', `/roles/${role}/sitting`);
  expect(again).toEqual({ status: 200, body: { ok: true, sitting: '1', resumed: true, said: [], now: 'waiting' } });
  const v = (await call('GET', '/sittings/1')).body;
  expect([v.kind, v.subject, v.name, v.open, v.due, v.position, v.total, v.closing, v.said]).toEqual(['role', role, 'Head of Platform, Fernway', true, true, 1, 15, '', []]);
  expect(v.turns.map((t: { mine: boolean; step: string; text: string }) => [t.mine, t.step, t.text])).toEqual([[false, 'opening', OPENING], [false, 'question', q(0)]]);
  const s = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([s.open, s.sitting, s.settled, s.lastAt > 0, s.lastOn === new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(s.lastAt)]).toEqual([true, '1', 0, true, true]);
});

test('an answer is stored exactly as sent, spaces and line breaks kept, and the next question comes back at once', async () => {
  const typed = '  I ran the platform team of six.\n\nI set its plans myself.  ';
  const r = await answer('1', typed);
  expect([r.status, r.body.ok, r.body.closes, r.body.now, lines(r.body.said)]).toEqual([200, true, false, 'waiting', [['question', q(1)]]]);
  expect(read('SELECT text FROM capture_turns WHERE id = ?', Number(r.body.turn))).toEqual([{ text: typed }]);
  const v = (await call('GET', '/sittings/1')).body;
  expect(v.turns.at(-2)).toEqual({ id: r.body.turn, mine: true, step: 'answer', text: typed });
  expect(v.position).toBe(2);
  expect((await answer('1', PICK)).body.said.map((t: { text: string }) => t.text)).toEqual([q(2)]);
});

test('a refused answer is said in words and stores nothing', async () => {
  const before = read('SELECT count(*) AS n FROM capture_turns');
  expect(await answer('1', '   \n ')).toEqual({ status: 409, body: { error: 'The answer is empty.' } });
  expect(await call('POST', '/sittings/1/answer', '[1]')).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  expect(await answer('1', 4)).toEqual({ status: 400, body: { error: 'Send the answer as text.' } });
  expect(await call('POST', '/sittings/1/answer', { text: 'Hello.' })).toEqual({ status: 400, body: { error: 'Send the question you are answering as well.' } });
  expect(await call('POST', '/sittings/99/answer', { text: 'Hello.' })).toEqual({ status: 404, body: { error: 'That interview is no longer in your record.' } });
  expect(await call('GET', '/sittings/99')).toEqual({ status: 404, body: { error: 'That interview is no longer in your record.' } });
  expect(read('SELECT count(*) AS n FROM capture_turns')).toEqual(before);
});

test('"I don\'t know" closes the question: the next one comes, and the status counts it closed', async () => {
  const r = await answer('1', "I don't know");
  expect([r.body.closes, lines(r.body.said)]).toEqual([true, [['question', q(3)]]]);
  const s = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([s.answered, s.closed, s.settled]).toEqual([2, 1, 3]);
});

test('stop for now: the paused closing line ends the sitting; an answer after it is refused; What you said lists the answers', async () => {
  const r = await call('POST', '/sittings/1/stop');
  expect(r).toEqual({ status: 200, body: { ok: true, said: [{ id: r.body.said[0].id, step: 'closing', text: CLOSING_PAUSED }], now: 'ended' } });
  expect(await call('POST', '/sittings/1/stop')).toEqual({ status: 200, body: { ok: true, said: [], now: 'ended' } });
  const late = await answer('1', 'One more thing.');
  expect([late.status, late.body.error, late.body.stale, late.body.sitting.open]).toEqual([409, 'That sitting has ended.', true, false]);
  const v = (await call('GET', '/sittings/1')).body;
  expect([v.open, v.due, v.position, v.closing]).toEqual([false, false, 0, CLOSING_PAUSED]);
  expect(v.said.map((g: { key: string; question: string; answers: { text: string; followUp: string; sitting: string }[] }) => [g.key, g.question, g.answers.map((a) => [a.sitting, a.text, a.followUp])])).toEqual([
    ['setting', q(0), [['1', '  I ran the platform team of six.\n\nI set its plans myself.  ', '']]],
    ['pick', q(1), [['1', PICK, '']]],
    ['before', q(2), [['1', "I don't know", '']]],
  ]);
  const s = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([s.open, s.sitting, s.settled]).toEqual([false, '1', 3]);
});

test('a new sitting reminds the owner of the work picked, in their own words, then asks the first question not settled', async () => {
  const r = await call('POST', `/roles/${role}/sitting`);
  expect([r.status, r.body.sitting, r.body.resumed, lines(r.body.said)]).toEqual([201, '2', false, [['opening', OPENING], ['reminder', reminderText(PICK)]].concat([['question', q(3)]])]);
  expect(reminderText(PICK)).toContain(PICK);
  expect((await call('GET', '/sittings/2')).body.position).toBe(4);
});

test('a follow-up is asked by rule, and its answer is listed under its question with the follow-up’s words', async () => {
  const r = await answer('2', 'We moved forty services.');
  expect(lines(r.body.said)).toEqual([['follow-up', 'What was your own part in that?']]);
  await answer('2', 'I wrote the plan for each service.');
  await call('POST', '/sittings/2/stop');
  const g = (await call('GET', '/sittings/2')).body.said.find((x: { key: string }) => x.key === 'own-part');
  expect(g.answers.map((a: { text: string; followUp: string }) => [a.text, a.followUp])).toEqual([['We moved forty services.', ''], ['I wrote the plan for each service.', 'What was your own part in that?']]);
});

test('one of the owner’s answers is deleted and its question opens again; the interviewer’s words cannot be deleted', async () => {
  const v = (await call('GET', '/sittings/1')).body;
  const gone = v.said.find((x: { key: string }) => x.key === 'before').answers[0].id;
  const asked = v.turns.find((t: { step: string }) => t.step === 'question').id;
  expect(await call('DELETE', `/sittings/1/turns/${asked}`)).toEqual({ status: 409, body: { error: 'Only your own answers can be deleted.' } });
  const before = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([before.answered, before.closed]).toEqual([3, 1]);
  expect(await call('DELETE', `/sittings/2/turns/${gone}`)).toEqual({ status: 404, body: { error: 'That answer is no longer in your record.' } });
  expect(await call('DELETE', `/sittings/1/turns/${gone}`)).toEqual({ status: 200, body: { ok: true } });
  expect(await call('DELETE', `/sittings/1/turns/${gone}`)).toEqual({ status: 404, body: { error: 'That answer is no longer in your record.' } });
  expect(read('SELECT count(*) AS n FROM capture_turns WHERE id = ?', Number(gone))).toEqual([{ n: 0 }]);
  // The question's own state: "before" was the only question closed, and nothing about it is left in any sitting.
  const after = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([after.answered, after.closed, after.settled]).toEqual([3, 0, 3]);
  expect(read("SELECT count(*) AS n FROM capture_turns WHERE who = 'owner' AND question = 'before'")).toEqual([{ n: 0 }]);
  expect((await call('GET', '/sittings/2')).body.said.map((g: { key: string }) => g.key)).toEqual(['setting', 'pick', 'own-part']);
});

test('deleting an answer takes its follow-up answers in that sitting with it; a follow-up answer alone goes alone', async () => {
  const group = async () => (await call('GET', '/sittings/2')).body.said.find((g: { key: string }) => g.key === 'own-part');
  const g = await group();
  expect(g.answers.map((a: { text: string; more: number }) => [a.text, a.more])).toEqual([['We moved forty services.', 1], ['I wrote the plan for each service.', 0]]);
  expect((await call('GET', '/sittings/2')).body.answers).toBe(2);
  const [main, follow] = g.answers.map((a: { id: string }) => a.id);
  expect(await call('DELETE', `/sittings/2/turns/${follow}`)).toEqual({ status: 200, body: { ok: true } });
  expect((await group()).answers.map((a: { text: string; more: number }) => [a.text, a.more])).toEqual([['We moved forty services.', 0]]);
  expect((await call('GET', `/roles/${role}/sitting`)).body.settled).toBe(3);
  expect(await call('DELETE', `/sittings/2/turns/${main}`)).toEqual({ status: 200, body: { ok: true } });
  expect((await call('GET', `/roles/${role}/sitting`)).body.settled).toBe(2);
  // In a new sitting, an answer with a follow-up answer: deleting the answer takes both, and the question opens again.
  const next = await call('POST', `/roles/${role}/sitting`);
  expect(lines(next.body.said).map(([step]) => step)).toEqual(['opening', 'reminder', 'question']);
  expect(next.body.said.at(-1).text).toBe(q(2));
  const sit = next.body.sitting;
  await answer(sit, "I don't know");
  expect(lines((await answer(sit, 'We moved the queues.')).body.said)).toEqual([['follow-up', 'What was your own part in that?']]);
  await answer(sit, 'I moved the payment queue myself.');
  await call('POST', `/sittings/${sit}/stop`);
  const mine = (await call('GET', `/sittings/${sit}`)).body.said.find((x: { key: string }) => x.key === 'own-part').answers;
  expect(mine.map((a: { more: number }) => a.more)).toEqual([1, 0]);
  expect(await call('DELETE', `/sittings/${sit}/turns/${mine[0].id}`)).toEqual({ status: 200, body: { ok: true } });
  expect(read("SELECT count(*) AS n FROM capture_turns WHERE who = 'owner' AND question = 'own-part'")).toEqual([{ n: 0 }]);
  expect((await call('GET', `/sittings/${sit}`)).body.said.map((x: { key: string }) => x.key)).toEqual(['setting', 'pick', 'before']);
  expect(await call('DELETE', `/sittings/${sit}`)).toEqual({ status: 200, body: { ok: true } });
});

test('a role sitting on a side project’s row is refused in words; a project sitting uses the project’s wording', async () => {
  const refused = await call('POST', `/roles/${side}/sitting`);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toStartWith('That row is a side project in the record, not a role. Start the sitting on its project, P-');
  const p = await call('POST', `/projects/${project}/sitting`);
  expect([p.status, lines(p.body.said)]).toEqual([201, [['opening', OPENING], ['question', questionText('setting', 'project')]]]);
  const v = (await call('GET', `/sittings/${p.body.sitting}`)).body;
  expect([v.kind, v.subject, v.name]).toEqual(['project', project, 'Moved every service to one cloud']);
});

test('a sitting is deleted with every word in it; its questions open again', async () => {
  expect(await call('DELETE', '/sittings/2')).toEqual({ status: 200, body: { ok: true } });
  expect(await call('DELETE', '/sittings/2')).toEqual({ status: 404, body: { error: 'That interview is no longer in your record.' } });
  expect(await call('GET', '/sittings/2')).toEqual({ status: 404, body: { error: 'That interview is no longer in your record.' } });
  expect(read('SELECT count(*) AS n FROM capture_turns WHERE sitting_id = 2')).toEqual([{ n: 0 }]);
  const s = (await call('GET', `/roles/${role}/sitting`)).body;
  expect([s.open, s.sitting, s.settled]).toEqual([false, '1', 2]);
});

test('two sends for one question at once store one answer; the other is refused in words with the sitting as it stands', async () => {
  const r3 = (await call('POST', '/roles', { title: 'Engineer', company: 'Pellmoor' })).body.id;
  const sit = (await call('POST', `/roles/${r3}/sitting`)).body.sitting, turn = await waiting(sit);
  const body = { text: 'I ran the team of six.', turn };
  const [a, b] = await Promise.all([call('POST', `/sittings/${sit}/answer`, body), call('POST', `/sittings/${sit}/answer`, body)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const refused = a.status === 409 ? a : b;
  expect([refused.body.error, refused.body.stale]).toEqual(['That question was already answered. Here is where the sitting stands.', true]);
  expect([refused.body.sitting.position, refused.body.sitting.turns.at(-1).text]).toEqual([2, q(1)]);
  expect(read("SELECT question, text FROM capture_turns WHERE sitting_id = ? AND who = 'owner'", Number(sit))).toEqual([{ question: 'setting', text: 'I ran the team of six.' }]);
  // A resend after a timeout, or a second tab, is the same: an old turn is refused and nothing is stored.
  expect((await call('POST', `/sittings/${sit}/answer`, { text: 'Again.', turn })).status).toBe(409);
  expect((await call('POST', `/sittings/${sit}/answer`, { text: 'Again.', turn: 'abc' })).status).toBe(400);
  expect(read("SELECT count(*) AS n FROM capture_turns WHERE sitting_id = ? AND who = 'owner'", Number(sit))).toEqual([{ n: 1 }]);
  await call('DELETE', `/roles/${r3}`);
});

test('with all 15 questions answered or closed the sitting ends itself, the status says so, and a new start is refused in words', async () => {
  const started = (await call('POST', `/roles/${role2}/sitting`)).body;
  let last = started;
  for (let i = 0; i < 15; i++) last = (await answer(started.sitting, "I don't know")).body;
  expect([last.now, lines(last.said)]).toEqual(['ended', [['closing', CLOSING_DONE]]]);
  const s = (await call('GET', `/roles/${role2}/sitting`)).body;
  expect([s.open, s.sitting, s.answered, s.closed, s.settled, s.total, s.lastOn !== '']).toEqual([false, started.sitting, 0, 15, 15, 15, true]);
  expect(await call('POST', `/roles/${role2}/sitting`)).toEqual({ status: 409, body: { error: 'Every question about this is already answered.' } });
});
