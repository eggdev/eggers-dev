// `bun test lib`: the words behind facts that Talk and pasted texts write (lib/origins.ts, lib/talk.ts): the passage the
// model names when it is exactly in the owner's message, else the whole message; a pasted text's passage only where the
// evidence is in it; and the one-time backfill for facts stored before, which is idempotent and never stores words that
// are not in the text it points at. On a scratch database; every person and employer is invented.
import { beforeEach, expect, test } from 'bun:test';
import { applyExtraction, type Extraction } from './db.ts';
import { db, fact, reset, role } from './scratch.ts';
import { fakeAsk } from './llm.ts';
import { reply, say, type TalkRow } from './talk.ts';
import { addOrigin, backfillOrigins, checkOrigin, evidenceSpan, originsOf, quoteOk, sourceOrigins, talkOriginOf } from './origins.ts';

const SAID = 'We moved the depot rota to the console in March. It cut the Monday scramble to ten minutes.';
const PASTED = 'Harborlight Systems, 2021 to now.\n- Built the dispatch console that 640 schedulers use.\n- Ran the Go guild.';
beforeEach(() => {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
});

const queued = () => db.query("SELECT * FROM talk WHERE status = 'queued'").get() as TalkRow;
const talkFact = (text: string, said?: unknown, replaces = '') => ({ roleKey: 'role:1', kind: 'accomplishment', text, detail: '', metric: '', skills: [], replaces, ...(said === undefined ? {} : { said }) });
const quotes = (id: number) => originsOf(id).map((o) => ({ kind: o.kind, quote: o.quote, start: o.start, end: o.end }));
const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;
const allHold = () => (db.query('SELECT fact_id FROM fact_origins').all() as { fact_id: number }[]).every((r) => originsOf(r.fact_id).every((o) => checkOrigin(o).state === 'holds'));

test('which message and passage a Talk fact came from: one passage in one message, else the one message whole, else none', () => {
  const one = [{ id: 7, body: SAID }];
  expect(talkOriginOf('It cut the Monday scramble to ten minutes.', one)).toEqual({ talkId: 7, start: 49, end: SAID.length });
  expect(talkOriginOf('  It cut the Monday scramble  ', one)).toEqual({ talkId: 7, start: 49, end: 75 });
  // Missing, changed in the copying, or a scrap: the whole message, since it is the only one.
  for (const s of [undefined, null, '', 'It cut the Monday scramble to 10 minutes.', 42, 'I', 'a', 'scramble']) expect(talkOriginOf(s, one)).toEqual({ talkId: 7, start: 0, end: SAID.length });
  // Two messages since the last reply written: the passage finds its message; without one, nothing is guessed.
  const two = [{ id: 7, body: 'I cut the billing run from 6 hours to 40 minutes.' }, { id: 9, body: 'Anything else you need?' }];
  expect(talkOriginOf('I cut the billing run from 6 hours', two)).toEqual({ talkId: 7, start: 0, end: 34 });
  for (const s of [undefined, 'I cut the billing run in half', 'billing']) expect(talkOriginOf(s, two)).toBeNull();
  // Words in both messages: which one is not guessed.
  expect(talkOriginOf('the depot rota', [{ id: 1, body: 'I ran the depot rota.' }, { id: 2, body: 'Then I sold the depot rota.' }])).toBeNull();
  expect(talkOriginOf('anything', [])).toBeNull();
});

test('a quote is at least 12 characters and two words, standing whole', () => {
  for (const q of ['I', 'a', 'Skills', 'led', 'Go, Rust', 'the team', 'onewordonlyhere']) expect(quoteOk(q)).toBe(false);
  for (const q of ['I led the team', 'Go and Rust work']) expect(quoteOk(q)).toBe(true);
});

test('short or partial words from the model never become a passage (said "I", "a", inside other words)', async () => {
  const body = 'It was hard. I led it. I also hired 3 people.';
  expect(say(body, 1)).toBe('');
  fakeAsk(() => ({ reply: 'ok', answered: [], facts: [talkFact('Led it.', 'I'), talkFact('Hired three people.', 'a'), talkFact('Did x.', ' '), talkFact('Y.', 'I led it. I also')] }));
  await reply(queued(), '/tmp');
  for (const t of ['Led it.', 'Hired three people.', 'Did x.']) expect(quotes(idOf(t))).toEqual([{ kind: 'talk', quote: body, start: 0, end: body.length }]);
  expect(quotes(idOf('Y.'))).toEqual([{ kind: 'talk', quote: 'I led it. I also', start: 13, end: 29 }]);
});

test('after a reply failed, a fact is linked to the message it came from, or to none', async () => {
  const you = (body: string, at: number) => (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, ?) RETURNING id").get(body, at) as { id: number }).id;
  const m1 = you('I cut the billing run from 6 hours to 40 minutes.', 1);
  db.query("INSERT INTO talk (who, status, note, created_at) VALUES ('claude', 'failed', 'timeout', 2)").run();
  expect(say('Anything else you need?', 3)).toBe('');
  fakeAsk(() => ({ reply: 'ok', answered: [], facts: [
    talkFact('Cut the billing run from 6 hours to 40 minutes.', 'I cut the billing run from 6 hours to 40 minutes.'),
    talkFact('Cut the billing run.', 'I cut the billing run in half'),
    talkFact('Ran billing.'),
  ] }));
  await reply(queued(), '/tmp');
  // Given and in exactly one message: that message, that passage.
  expect(originsOf(idOf('Cut the billing run from 6 hours to 40 minutes.')).map((o) => [o.refId, o.quote])).toEqual([[m1, 'I cut the billing run from 6 hours to 40 minutes.']]);
  // Not found, or not given, with two messages unanswered: none.
  expect(originsOf(idOf('Cut the billing run.'))).toEqual([]);
  expect(originsOf(idOf('Ran billing.'))).toEqual([]);
  // The next reply answers one message only: its whole message again, when the passage is not found.
  expect(say('We also moved payroll to the same run.', 4)).toBe('');
  fakeAsk(() => ({ reply: 'ok', answered: [], facts: [talkFact('Moved payroll to the billing run.', 'moved payroll to the billing run')] }));
  await reply(queued(), '/tmp');
  expect(quotes(idOf('Moved payroll to the billing run.')).map((o) => o.quote)).toEqual(['We also moved payroll to the same run.']);
  expect(allHold()).toBe(true);
});

test('a Talk reply links each fact to the passage it names, or to the whole message when the passage is not in it', async () => {
  expect(say(SAID, 1)).toBe('');
  fakeAsk(() => ({ reply: 'Noted.', answered: [], facts: [
    talkFact('Moved the depot rota to the console.', 'We moved the depot rota to the console in March.'),
    talkFact('Cut the Monday scramble to ten minutes.', 'It cut the Monday scramble to 10 minutes.'),
    talkFact('Ran the rota.', null),
    talkFact('Planned the move.'),
  ] }));
  await reply(queued(), '/tmp');
  const turn = (db.query("SELECT id FROM talk WHERE who = 'you'").get() as { id: number }).id;
  expect(quotes(idOf('Moved the depot rota to the console.'))).toEqual([{ kind: 'talk', quote: 'We moved the depot rota to the console in March.', start: 0, end: 48 }]);
  for (const t of ['Cut the Monday scramble to ten minutes.', 'Ran the rota.', 'Planned the move.']) expect(quotes(idOf(t))).toEqual([{ kind: 'talk', quote: SAID, start: 0, end: SAID.length }]);
  expect(originsOf(idOf('Ran the rota.'))[0].refId).toBe(turn);
  expect(allHold()).toBe(true);
});

test('a fact Talk rewrites loses its told passages, keeps its other words, and gains the new message', async () => {
  const f = fact(1, 'Moved the rota.');
  const src = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', ?, 'done', 1) RETURNING id").get(PASTED) as { id: number }).id;
  expect(addOrigin(f, { kind: 'source', refId: src, start: 0, end: 19 }).ok).toBe(true);
  db.query("INSERT INTO fact_origins (fact_id, kind, ref_id, span_start, span_end, quote) VALUES (?, 'told', 999, 0, 4, 'Told')").run(f);
  expect(say(SAID, 2)).toBe('');
  fakeAsk(() => ({ reply: 'Noted.', answered: [], facts: [talkFact('Moved the depot rota to the console in March.', 'We moved the depot rota to the console in March.', `fact:${f}`)] }));
  await reply(queued(), '/tmp');
  expect(quotes(f).map((o) => [o.kind, o.quote])).toEqual([['source', 'Harborlight Systems'], ['talk', 'We moved the depot rota to the console in March.']]);
});

test('a pasted text’s evidence: a quote, a quote in marks or among other words, pieces joined, and nothing when it is not there', () => {
  const at = (w: string) => ({ start: PASTED.indexOf(w), end: PASTED.indexOf(w) + w.length });
  expect(evidenceSpan('Built the dispatch console that 640 schedulers use.', PASTED)).toEqual(at('Built the dispatch console that 640 schedulers use.'));
  expect(evidenceSpan('“Built the dispatch console that 640 schedulers use.”', PASTED)).toEqual(at('Built the dispatch console that 640 schedulers use.'));
  expect(evidenceSpan('The notes say "Ran the Go guild" under Harborlight.', PASTED)).toEqual(at('Ran the Go guild'));
  expect(evidenceSpan('commit a1b2c3 · Ran the Go guild.', PASTED)).toEqual(at('Ran the Go guild.'));
  expect(evidenceSpan('Built the dispatch console for 640 schedulers.', PASTED)).toBeNull();
  // Not inside a longer word, and not a scrap too short to mean anything.
  expect(evidenceSpan('Harbor', PASTED)).toBeNull();
  expect(evidenceSpan('Go', PASTED)).toBeNull();
  expect(evidenceSpan('', PASTED)).toBeNull();
  // A word or a heading quoted inside the evidence is not a passage.
  const body = 'Skills: Go, Rust. The team shipped the console. I led the team of six.';
  for (const e of ['Listed under "Skills" on the page', 'The CV says he "led" people', 'the', 'Summary of the role · team', 'led the team of 6', 'Go, Rust']) expect(evidenceSpan(e, body)).toBeNull();
  expect(evidenceSpan('"I led the team of six."', body)).toEqual({ start: body.indexOf('I led'), end: body.length });
});

test('after a reading, a pasted text’s facts get the passage their evidence quotes; a file’s get none', () => {
  const text = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', ?, 'done', 1) RETURNING id").get(PASTED) as { id: number }).id;
  const file = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('file', 'cv.pdf', 'cv.pdf', 'done', 1) RETURNING id").get() as { id: number }).id;
  const read = (facts: { text: string; evidence: string }[]): Extraction => ({ roles: [], facts: facts.map((f) => ({ roleKey: 'role:1', kind: 'accomplishment', detail: '', metric: '', skills: [], replaces: '', ...f })) });
  applyExtraction(text, read([{ text: 'Built the dispatch console.', evidence: '"Built the dispatch console that 640 schedulers use."' }, { text: 'Led the guild.', evidence: 'Led a guild of engineers.' }]), 5);
  applyExtraction(file, read([{ text: 'Wrote the cv.', evidence: 'cv.pdf' }]), 5);
  expect(sourceOrigins(text, 6)).toBe(1);
  expect(sourceOrigins(file, 6)).toBe(0);
  expect(quotes(idOf('Built the dispatch console.')).map((o) => o.quote)).toEqual(['Built the dispatch console that 640 schedulers use.']);
  expect(originsOf(idOf('Led the guild.'))).toEqual([]);
  expect(originsOf(idOf('Wrote the cv.'))).toEqual([]);
  // Read again with the same words, the fact keeps its one origin; nothing is added twice.
  applyExtraction(text, read([{ text: 'Built the dispatch console.', evidence: '"Built the dispatch console that 640 schedulers use."' }]), 7);
  expect(sourceOrigins(text, 8)).toBe(0);
  expect(originsOf(idOf('Built the dispatch console.')).length).toBe(1);
  expect(allHold()).toBe(true);
});

test('the backfill links old Talk facts to their message and old pasted facts to their passage, once, and only with words in the text', () => {
  // Talk as it was before origins: the owner's message, the reply that added two facts and updated one.
  const you = (body: string, at: number) => (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, ?) RETURNING id").get(body, at) as { id: number }).id;
  const claude = (added: string[], at: number) => db.query("INSERT INTO talk (who, body, added, status, created_at) VALUES ('claude', 'Noted.', ?, 'done', ?)").run(JSON.stringify(added), at);
  const told = (text: string) => (db.query("INSERT INTO facts (role_id, kind, text, evidence, status, created_at) VALUES (1, 'accomplishment', ?, 'Said by you in Talk on 2026-03-02.', 'confirmed', 1) RETURNING id").get(text) as { id: number }).id;
  const first = you(SAID, 1);
  const a = told('Moved the depot rota.'), b = told('Cut the Monday scramble.');
  claude(['Moved the depot rota.', 'Updated: Cut the Monday scramble.'], 2);
  const second = you('I also ran the guild. And the rota.', 3);
  // Said twice in Talk: which turn it came from is not guessed.
  const twice1 = told('Ran the guild.'), twice2 = told('Ran the guild.');
  // Reworded by hand since: no fact has the sentence any more.
  const edited = told('Ran the Go guild for two years.');
  claude(['Ran the guild.', 'Ran the guild for two years.'], 4);
  // A fact that already has an origin is left alone.
  const had = told('Kept its words.');
  expect(addOrigin(had, { kind: 'talk', refId: second, start: 0, end: 5 }).ok).toBe(true);
  claude(['Kept its words.'], 5);
  // A pasted text read before origins: one fact's evidence is in it, one's is not.
  const src = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', ?, 'done', 1) RETURNING id").get(PASTED) as { id: number }).id;
  const inText = db.query("INSERT INTO facts (role_id, kind, text, evidence, source_id, status, created_at) VALUES (1, 'accomplishment', 'Ran the Go guild.', 'Ran the Go guild.', ?, 'proposed', 1) RETURNING id").get(src) as { id: number };
  const notInText = db.query("INSERT INTO facts (role_id, kind, text, evidence, source_id, status, created_at) VALUES (1, 'accomplishment', 'Mentored four engineers.', 'Mentored 4 engineers.', ?, 'proposed', 1) RETURNING id").get(src) as { id: number };

  expect(backfillOrigins(10)).toBe(3);
  expect(quotes(a)).toEqual([{ kind: 'talk', quote: SAID, start: 0, end: SAID.length }]);
  expect(originsOf(b).map((o) => o.refId)).toEqual([first]);
  for (const id of [twice1, twice2, edited, notInText.id]) expect(originsOf(id)).toEqual([]);
  expect(quotes(had)).toEqual([{ kind: 'talk', quote: 'I als', start: 0, end: 5 }]);
  expect(quotes(inText.id).map((o) => [o.kind, o.quote])).toEqual([['source', 'Ran the Go guild.']]);
  expect(allHold()).toBe(true);
  // Again: nothing more, nothing changed.
  const before = db.query('SELECT * FROM fact_origins ORDER BY id').all();
  expect(backfillOrigins(20)).toBe(0);
  expect(db.query('SELECT * FROM fact_origins ORDER BY id').all()).toEqual(before);
});

test('the backfill adds nothing for a sentence more than one reply lists', () => {
  const you = (body: string, at: number) => (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, ?) RETURNING id").get(body, at) as { id: number }).id;
  const claude = (added: string[], at: number) => db.query("INSERT INTO talk (who, body, added, status, created_at) VALUES ('claude', 'Noted.', ?, 'done', ?)").run(JSON.stringify(added), at);
  const told = (text: string) => (db.query("INSERT INTO facts (role_id, kind, text, evidence, status, created_at) VALUES (1, 'accomplishment', ?, 'Said by you in Talk on 2026-03-02.', 'confirmed', 1) RETURNING id").get(text) as { id: number }).id;
  // "Led the support desk." was added, reworded to the billing desk, and added again from a later message.
  you('I led the support desk.', 1); const f1 = told('Led the billing desk.'); claude(['Led the support desk.'], 2);
  const m2 = you('Sorry, the billing desk.', 3); claude(['Updated: Led the billing desk.'], 4);
  you('Before that, at Tessellate, I led the support desk for two years.', 5); const f2 = told('Led the support desk.'); claude(['Led the support desk.'], 6);
  expect(backfillOrigins(10)).toBe(1);
  expect(originsOf(f1).map((o) => [o.refId, o.quote])).toEqual([[m2, 'Sorry, the billing desk.']]);
  expect(originsOf(f2)).toEqual([]);
  // A reply after a failed one answered two messages: which one is not guessed.
  you('I ran the hiring round.', 7);
  db.query("INSERT INTO talk (who, status, note, created_at) VALUES ('claude', 'failed', 'timeout', 8)").run();
  you('And the onboarding.', 9); const f3 = told('Ran onboarding.'); claude(['Ran onboarding.'], 10);
  expect(backfillOrigins(11)).toBe(0);
  expect(originsOf(f3)).toEqual([]);
});
