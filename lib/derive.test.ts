// `bun test lib`: deriving a told story (lib/derive.ts). The model is a stand-in (fakeAsk): no model is ever asked. What
// it proves: what the model is given; every check drops what fails it, never repairing it by a guess; a part the owner
// typed or edited is never overwritten; deriving again replaces only its own proposed facts; a fact the owner deleted
// stays out; a failure changes nothing and shows in Activity; a deleted answer takes its quotes with it and queues the
// story again; and the record's questions, source readings and tools leave a told fact alone. Everything is invented.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, role, seed } from './scratch.ts';
import { applyExtraction } from './db.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { activity } from './activity.ts';
import { askDerive, checkDerived, deriveFor, leftNote, runQueued, type Raw, type RawFact } from './derive.ts';
import { advance, answerTurn, deleteOwnerTurn, deleteSitting, startSitting, toldAbout, turnsOf } from './sittings.ts';
import { originsOf } from './origins.ts';
import { patchFact, removeFact } from './record.ts';
import { syncRecordQuestions } from './gaps.ts';
import { answer, choiceAt, openRaised } from './raised.ts';

const now = 1_800_000_000_000;
let project = 0, other = 0;
const ok = <T extends { ok: boolean }>(d: T) => { if (!d.ok) throw new Error(JSON.stringify(d)); return d as Extract<T, { ok: true }>; };

// One sitting about a project, answered in order with these words, then stopped. Returns each answer's turn id.
function tell(p: number, answers: string[], at = now): number[] {
  const id = ok(startSitting(p, at)).id;
  ok(advance(id, at));
  const turns = answers.map((a) => ok(answerTurn(id, turnsOf(id).at(-1)!.id, a, at)).id);
  ok(advance(id, at, { stop: true }));
  return turns;
}
const SETTING = 'I ran the depot rota console for the schedulers, and honestly the old one was a mess, lol.';
const BEFORE = 'Schedulers planned 35 depots on paper every Sunday night.';
const OWN = 'I wrote the scheduler myself in TypeScript and moved the depots over one by one.';
let turns: number[] = [];

beforeEach(() => {
  seed();
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2023-03' });
  project = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Depot rota console', 1) RETURNING id").get() as { id: number }).id;
  other = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (4, 'Cloud move', 1) RETURNING id").get() as { id: number }).id;
  turns = tell(project, [SETTING, BEFORE, OWN]);
  tell(other, ['I moved 40 services to one cloud.']);
  db.run("UPDATE projects SET derive_status = '', derive_note = ''");
});
afterEach(() => fakeAsk());

const fact = (f: Partial<RawFact> & { text: string; quotes: RawFact['quotes'] }): RawFact => ({ detail: '', metric: '', baseline: '', team: '', own_part: '', skills: [], kind: 'accomplishment', ...f });
const raw = (r: Partial<Raw> = {}): Raw => ({ context: '', action: '', result: '', learning: '', facts: [], ...r });
const GOOD = () => raw({
  context: 'Schedulers planned 35 depots on paper every Sunday night.',
  action: 'I wrote the scheduler myself in TypeScript and moved the depots over one by one.',
  facts: [fact({ text: 'Wrote the depot scheduler in TypeScript.', own_part: 'Wrote it alone.', skills: ['TypeScript', ' typescript ', ''], quotes: [{ turn: turns[2], quote: 'I wrote the scheduler myself in TypeScript' }] }),
    fact({ text: 'Moved 35 depots off paper planning.', metric: '35 depots', kind: 'project', quotes: [{ turn: turns[1], quote: 'planned 35 depots on paper' }, { turn: turns[2], quote: 'moved the depots over one by one' }] })],
});
const parts = (p = project) => db.query('SELECT context, action, result, learning FROM projects WHERE id = ?').get(p) as Record<string, string>;
const told = (p = project) => db.query('SELECT id, text, status, told, role_id, project_id, skills, metric FROM facts WHERE told = 1 AND project_id IS ? ORDER BY id').all(p) as { id: number; text: string; status: string; told: number; role_id: number; project_id: number; skills: string; metric: string }[];

test('what the model is given: the job, the project and every answer about it word for word, but those that are only "I don\'t know"', async () => {
  tell(project, ["I don't know", 'We shipped it in March.'], now + 5);
  const asked: Ask[] = [];
  fakeAsk((call) => { asked.push(call); return raw(); });
  process.env.EGG_DERIVE_MODEL = 'haiku';
  try { await deriveFor(project, '.', () => now); } finally { delete process.env.EGG_DERIVE_MODEL; }
  expect(asked.length).toBe(1);
  expect(asked[0].model).toBe('haiku');
  const p = asked[0].prompt;
  expect(p).toContain('The job, for context only: Director of Engineering at Harborlight Systems, 2021-03 to now.');
  expect(p).toContain('The piece of work, in their own words: Depot rota console.');
  expect(p).toContain(JSON.stringify(SETTING));
  expect(p).toContain(`{"turn":${turns[1]},"part":"context","question":"Take me back to the start. What was happening just before you got involved?","followUp":"","answer":${JSON.stringify(BEFORE)}}`);
  expect(p).not.toContain("I don't know\"");
  expect(p).not.toContain('40 services');
  expect(p).toContain('Never invent, round up or infer a number');
  expect(p).toContain('Do not report every line.');
  expect(toldAbout(project).map((t) => t.text)).toEqual([SETTING, BEFORE, OWN, 'We shipped it in March.']);
});

test('the happy path: the parts and the facts are written, each fact proposed and told, with its quotes as told origins', async () => {
  fakeAsk(() => GOOD());
  expect(await deriveFor(project, '.', () => now)).toBe('');
  expect(parts()).toEqual({ context: BEFORE, action: OWN, result: '', learning: '' });
  const f = told();
  expect(f.map((x) => [x.text, x.status, x.role_id, x.project_id, x.skills, x.metric])).toEqual([
    ['Wrote the depot scheduler in TypeScript.', 'proposed', 1, project, 'TypeScript', ''],
    ['Moved 35 depots off paper planning.', 'proposed', 1, project, '', '35 depots']]);
  expect(originsOf(f[1].id).map((o) => [o.kind, o.refId, o.quote])).toEqual([['told', turns[1], 'planned 35 depots on paper'], ['told', turns[2], 'moved the depots over one by one']]);
  expect(JSON.parse((db.query('SELECT derived FROM projects WHERE id = ?').get(project) as { derived: string }).derived)).toEqual({ context: BEFORE, action: OWN, result: '', learning: '' });
});

test('every check drops what fails it: a forged, short or unrelated quote, a quote from another turn, a number not said or said only about another project, a bad kind, a duplicate', () => {
  const told = toldAbout(project);
  const c = checkDerived(raw({
    result: 'Planning went from 2 days to 2 hours.',
    facts: [
      fact({ text: 'Forged.', quotes: [{ turn: turns[1], quote: 'planned 36 depots' }] }),
      fact({ text: 'Planned depots from another turn.', quotes: [{ turn: turns[0], quote: 'planned 35 depots on paper' }] }),
      fact({ text: 'Moved services from another project.', quotes: [{ turn: 999999, quote: 'I moved 40 services' }] }),
      fact({ text: 'Planned the schedulers’ week.', quotes: [{ turn: turns[1], quote: 'Schedulers' }, { turn: turns[2], quote: 'I' }] }),
      fact({ text: 'Ran the weekly hiring panel.', quotes: [{ turn: turns[1], quote: 'every Sunday night' }] }),
      fact({ text: 'Planned 35 depots in 80% less time.', quotes: [{ turn: turns[1], quote: 'planned 35 depots' }] }),
      fact({ text: 'Moved 40 services.', quotes: [{ turn: turns[2], quote: 'moved the depots over' }] }),
      fact({ text: 'Named the old one a mess.', detail: 'It took 3 people.', quotes: [{ turn: turns[0], quote: 'the old one was a mess' }] }),
      fact({ text: 'Planned 35% of depots on paper.', quotes: [{ turn: turns[1], quote: 'planned 35 depots on paper' }] }),
      fact({ text: 'Planned 35 depots on paper since 2019.', quotes: [{ turn: turns[1], quote: 'planned 35 depots on paper' }] }),
      fact({ text: 'Planned a dozen depots on paper.', quotes: [{ turn: turns[1], quote: 'planned 35 depots on paper' }] }),
      fact({ text: 'A kind of its own.', kind: 'triumph', quotes: [{ turn: turns[1], quote: 'planned 35 depots' }] }),
      fact({ text: '   ', quotes: [{ turn: turns[1], quote: 'planned 35 depots' }] }),
      fact({ text: 'x'.repeat(301), quotes: [{ turn: turns[1], quote: 'planned 35 depots' }] }),
      fact({ text: 'Planned 35 depots on paper.', skills: ['TypeScript', 'Kafka', 'Go', 'Python 3', 'typescript'], quotes: [{ turn: turns[1], quote: 'planned 35 depots' }, { turn: turns[2], quote: 'I' }] }),
      fact({ text: 'planned  35 depots on paper.', quotes: [{ turn: turns[1], quote: 'depots on paper' }] }),
    ] }), told);
  expect(c.facts.map((f) => [f.text, f.skills, f.quotes.map((q) => q.quote)])).toEqual([['Planned 35 depots on paper.', ['TypeScript'], ['planned 35 depots']]]);
  expect(c.parts.result).toBeNull();
  expect(c.left).toEqual({ quote: 5, number: 6, shape: 3, same: 1, deleted: 0, many: 0, parts: ['result'] });
  expect(leftNote(c.left)).toBe('The result was not written: it held a number you did not say. 6 facts were left out: each held a number you did not say. 5 facts were left out: each quoted none of your words that show it. '
    + '3 facts were left out: each was empty, too long or of no known kind. 1 fact was left out: it said what another fact already says.');
  // A number is written in the form it was said: "35" was said, "thirty-five" was not.
  expect(checkDerived(raw({ context: 'Thirty-five depots planned on paper.' }), told).parts.context).toBeNull();
  expect(checkDerived(raw({ context: 'The depots were moved over one by one.' }), told).parts.context).toBe('The depots were moved over one by one.');
  // At most eight facts are kept.
  const many = checkDerived(raw({ facts: Array.from({ length: 10 }, (_, i) => fact({ text: `Ran the depot console, part ${'abcdefghij'[i]}.`, quotes: [{ turn: turns[0], quote: 'the depot rota console' }] })) }), told);
  expect([many.facts.length, many.left.many]).toEqual([8, 2]);
  // An answer not in the shape asked for gives nothing.
  expect(checkDerived({} as Raw, told)).toMatchObject({ facts: [], parts: { context: '', action: '', result: '', learning: '' } });
});

test('with only "40 users" said, no other number is written: years, dates, durations, number words, and the same value with another unit', () => {
  const told = [{ turn: 1, key: 'changed', part: 'result' as const, question: '', followUp: '', text: 'We reached 40 users.', at: 1 }];
  for (const t of ['It ran for 3 years since 2019.', 'It was a 5-year deal.', 'It went live on March 3, 2021.', 'It had one hundred users.', 'It had a dozen users.',
    'It had a million users.', 'Doubling the users.', 'Cut costs by 40%.', 'It cost $40.', 'It was 40x faster.', 'It ran on version 2.1.', 'It came 1st.']) {
    expect([t, checkDerived(raw({ result: t }), told).parts.result]).toEqual([t, null]);
  }
  for (const t of ['We reached 40 users.', 'It reached 40 people.']) expect(checkDerived(raw({ result: t }), told).parts.result).toBe(t);
});

test('a part the owner typed or edited is kept; a part as deriving last wrote it is replaced; a part written empty clears only deriving’s words', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  db.query("UPDATE projects SET action = 'I wrote it, and I would write it again.', result = 'The owner wrote this.' WHERE id = ?").run(project);
  fakeAsk(() => raw({ context: 'Schedulers planned on paper.', action: 'I wrote the scheduler.', result: 'It changed.', learning: 'Moving depots one by one worked.' }));
  await deriveFor(project, '.', () => now + 1);
  expect(parts()).toEqual({ context: 'Schedulers planned on paper.', action: 'I wrote it, and I would write it again.', result: 'The owner wrote this.', learning: 'Moving depots one by one worked.' });
  fakeAsk(() => raw());
  await deriveFor(project, '.', () => now + 2);
  expect(parts()).toEqual({ context: '', action: 'I wrote it, and I would write it again.', result: 'The owner wrote this.', learning: '' });
});

test('a part the owner cleared stays empty; a part never written and empty is written', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  db.query("UPDATE projects SET context = '' WHERE id = ?").run(project);
  fakeAsk(() => raw({ context: 'Schedulers planned on paper.', action: OWN, result: 'Planning moved to the console.' }));
  await deriveFor(project, '.', () => now + 1);
  expect(parts()).toEqual({ context: '', action: OWN, result: 'Planning moved to the console.', learning: '' });
});

test('deriving again replaces its own proposed facts, keeps one the owner edited, and drops a new fact that says the same as a kept one', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  const [edited, plain] = told();
  ok(patchFact(edited.id, { text: 'Wrote the depot scheduler in TypeScript, alone.' }, now));
  fakeAsk(() => raw({ facts: [fact({ text: 'Wrote the depot scheduler in TypeScript, alone.', quotes: [{ turn: turns[2], quote: 'I wrote the scheduler myself' }] }),
    fact({ text: 'Planned 35 depots each Sunday.', quotes: [{ turn: turns[1], quote: 'every Sunday night' }] })] }));
  expect(await deriveFor(project, '.', () => now + 1)).toBe('1 fact was left out: it said what another fact already says.');
  expect(told().map((f) => [f.text, f.status])).toEqual([['Wrote the depot scheduler in TypeScript, alone.', 'confirmed'], ['Planned 35 depots each Sunday.', 'proposed']]);
  expect(db.query('SELECT 1 FROM facts WHERE id = ?').get(plain.id)).toBeNull();
  expect(originsOf(plain.id)).toEqual([]);
  // The new fact takes a new reference number, above every one ever used.
  expect(told()[1].id).toBeGreaterThan(plain.id);
});

test('a fact the owner deleted stays out when the story is written again', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  ok(removeFact(told()[0].id, now));
  expect(await deriveFor(project, '.', () => now + 1)).toBe('1 fact was left out: it had the words of a fact you deleted.');
  expect(told().map((f) => f.text)).toEqual(['Moved 35 depots off paper planning.']);
});

test('a failure of the model changes nothing, shows in Activity with its reason, and is asked again by the same path', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  const before = { parts: parts(), facts: told() };
  expect(askDerive(project)).toBe('');
  expect(askDerive(project)).toBe('The story is being written now.');
  expect(activity(Date.now()).items.find((i) => i.kind === 'derive-story')).toMatchObject({ subject: String(project), status: 'waiting', what: `Writing the story P-${String(project).padStart(3, '0')}, Depot rota console`, link: `/record/project/${project}` });
  const stages: string[] = [];
  fakeAsk(() => { stages.push((db.query('SELECT derive_status FROM projects WHERE id = ?').get(project) as { derive_status: string }).derive_status); throw new Error('The model did not answer in time.'); });
  expect(await runQueued('.', () => now + 1)).toBe(true);
  expect(stages).toEqual(['running']);
  expect({ parts: parts(), facts: told() }).toEqual(before);
  expect(db.query('SELECT derive_status, derive_note FROM projects WHERE id = ?').get(project)).toEqual({ derive_status: 'failed', derive_note: 'The model did not answer in time.' });
  expect(activity(Date.now()).items.find((i) => i.kind === 'derive-story')).toMatchObject({ status: 'failed', reason: 'The model did not answer in time.' });
  expect(askDerive(project)).toBe('');
  fakeAsk(() => GOOD());
  expect(await runQueued('.', () => now + 2)).toBe(true);
  expect(db.query('SELECT derive_status FROM projects WHERE id = ?').get(project)).toEqual({ derive_status: 'done' });
  expect(activity(Date.now()).items.some((i) => i.kind === 'derive-story')).toBe(false);
  expect(await runQueued('.', () => now + 3)).toBe(false);
});

test('a sitting that ends with something said queues the story; one with only "I don\'t know" or nothing does not', () => {
  const status = (p: number) => (db.query('SELECT derive_status FROM projects WHERE id = ?').get(p) as { derive_status: string }).derive_status;
  const third = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (4, 'Hiring round', 1) RETURNING id").get() as { id: number }).id;
  tell(third, ["I don't know", 'Not sure.']);
  expect(status(third)).toBe('');
  tell(third, []);
  expect(status(third)).toBe('');
  tell(third, ['I hired three engineers.']);
  expect(status(third)).toBe('queued');
  expect(askDerive(99999)).toBe('That project is no longer in your record.');
});

test('deleting an answer removes the origins that quote it and queues the story; with nothing left, writing it clears what deriving wrote', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  db.run("UPDATE projects SET derive_status = 'done'");
  const moved = told()[1];
  expect(originsOf(moved.id).length).toBe(2);
  expect(deleteOwnerTurn(turns[1])).toBe(true);
  expect(originsOf(moved.id).map((o) => o.refId)).toEqual([turns[2]]);
  expect(db.query('SELECT derive_status FROM projects WHERE id = ?').get(project)).toEqual({ derive_status: 'queued' });
  // The fact whose quote is gone is written again only if the answers left still hold it.
  fakeAsk(() => GOOD());
  expect(await runQueued('.', () => now + 1)).toBe(true);
  expect(told().map((f) => f.text)).toEqual(['Wrote the depot scheduler in TypeScript.']);
  expect(parts().context).toBe('');
  // Every sitting deleted: nothing is asked of a model, and deriving's parts and facts go.
  db.run("UPDATE projects SET derive_status = 'done'");
  for (const s of db.query('SELECT id FROM capture_sittings WHERE project_id = ?').all(project) as { id: number }[]) deleteSitting(s.id);
  fakeAsk(() => { throw new Error('No model should be asked.'); });
  expect(await runQueued('.', () => now + 2)).toBe(true);
  expect([parts(), told()]).toEqual([{ context: '', action: '', result: '', learning: '' }, []]);
  expect(db.query('SELECT told_at FROM projects WHERE id = ?').get(project)).toEqual({ told_at: 0 });
});

test('a part left empty after deriving is asked on Home; its answer is the owner’s and a later deriving keeps it', async () => {
  db.run("UPDATE projects SET derive_status = 'queued' WHERE id = " + project);
  syncRecordQuestions(now);
  expect(openRaised().filter((q) => q.key.startsWith(`record:part:${project}:`))).toEqual([]);
  fakeAsk(() => GOOD());
  await runQueued('.', () => now);
  syncRecordQuestions(now + 1);
  const key = `record:part:${project}:result`;
  expect(openRaised().some((q) => q.key === key)).toBe(true);
  expect(answer(key, 0, 'Sunday planning stopped.', now + 2, choiceAt(key, 0))).toBe('');
  fakeAsk(() => raw({ result: 'Planning moved to the console.' }));
  await deriveFor(project, '.', () => now + 3);
  expect(parts().result).toBe('Sunday planning stopped.');
});

test('a told fact is left alone by a source reading, which can neither reword nor delete it; an answer about it makes it the owner’s', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  const f = told()[1];
  const source = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', 'Invented notes.', 'running', 1) RETURNING id").get() as { id: number }).id;
  applyExtraction(source, { roles: [], facts: [{ roleKey: 'role:1', kind: 'accomplishment', text: 'Moved every depot off paper, with a new wording.', detail: '', metric: '', skills: [], evidence: '', replaces: `fact:${f.id}` }] }, now);
  expect(db.query('SELECT text, status FROM facts WHERE id = ?').get(f.id)).toEqual({ text: 'Moved 35 depots off paper planning.', status: 'proposed' });
  applyExtraction(source, { roles: [], facts: [] }, now);
  expect(db.query('SELECT 1 AS here FROM facts WHERE id = ?').get(f.id)).toEqual({ here: 1 });
  db.query("UPDATE facts SET baseline = '', own_part = '' WHERE id = ?").run(f.id);
  db.query("INSERT INTO raised_questions (key, kind, text, choices, about, data, raised_at) VALUES (?, 'record', 'Before?', ?, '', ?, 1)")
    .run(`record:baseline:${f.id}`, JSON.stringify(['Give it', 'There was none', 'I don’t know']), JSON.stringify({ kind: 'baseline', subject: f.id, rank: 0, route: '', actions: [{ field: 'baseline', input: 'line' }, { field: 'baseline', value: 'There was none' }, { field: 'none' }] }));
  expect(answer(`record:baseline:${f.id}`, 1, '', now, choiceAt(`record:baseline:${f.id}`, 1))).toBe('');
  expect(db.query('SELECT baseline, status FROM facts WHERE id = ?').get(f.id)).toEqual({ baseline: 'There was none', status: 'confirmed' });
});

test('a told fact reworded in Talk is the owner’s and loses the passages it quoted, which no longer show its words', async () => {
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  const f = told()[0];
  expect(originsOf(f.id).length).toBe(1);
  const { reply } = await import('./talk.ts');
  fakeAsk(() => ({ reply: 'Noted.', answered: [], facts: [{ roleKey: 'role:1', kind: 'accomplishment', text: 'Wrote the depot scheduler in Go.', detail: '', metric: '', skills: [], replaces: `fact:${f.id}` }] }));
  db.run("INSERT INTO talk (id, who, status, created_at) VALUES (1, 'claude', 'queued', 1)");
  await reply({ id: 1 } as never, '.');
  expect(db.query('SELECT text, status FROM facts WHERE id = ?').get(f.id)).toEqual({ text: 'Wrote the depot scheduler in Go.', status: 'confirmed' });
  expect(originsOf(f.id)).toEqual([]);
});

test('a told fact the owner marks is theirs: deriving again keeps it', async () => {
  const { setFactMark } = await import('./standing.ts');
  fakeAsk(() => GOOD());
  await deriveFor(project, '.', () => now);
  const f = told()[0];
  expect(setFactMark(f.id, 'kept', now)).toBe('');
  await deriveFor(project, '.', () => now + 1);
  expect(db.query('SELECT status FROM facts WHERE id = ?').get(f.id)).toEqual({ status: 'confirmed' });
});
