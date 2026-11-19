// `bun test lib`: the link from a fact to the owner's own words (lib/origins.ts), on a scratch database with an
// invented person (lib/scratch.ts).
import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyExtraction, deleteFact, foldFacts, type Extraction } from './db.ts';
import { db, fact, reset, role } from './scratch.ts';
import { forget } from './talk.ts';
import { addOrigin, checkOrigin, checkSpan, originsOf, removeOrigin } from './origins.ts';

const SAID = 'We moved the depot rota to the console in March. It cut the Monday scramble to ten minutes.';
const PASTED = 'Harborlight Systems, 2021 to now. Built the dispatch console that 640 schedulers use.';
let turn = 0, reply = 0, source = 0, f = 0;

const ok = <T extends { ok: boolean }>(d: T) => { if (!d.ok) throw new Error(JSON.stringify(d)); return d as Extract<T, { ok: true }>; };

beforeEach(() => {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  f = fact(1, 'Cut the Monday rota scramble to ten minutes.');
  turn = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, 1) RETURNING id").get(SAID) as { id: number }).id;
  reply = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('claude', 'How many people did it reach?', 2) RETURNING id").get() as { id: number }).id;
  source = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', ?, 'done', 3) RETURNING id").get(PASTED) as { id: number }).id;
});

const span = (text: string, words: string) => ({ start: text.indexOf(words), end: text.indexOf(words) + words.length });

test('a fact links to a turn of Talk, a source text and its own typed words, with a copy of each', () => {
  const a = ok(addOrigin(f, { kind: 'talk', refId: turn, ...span(SAID, 'It cut the Monday scramble to ten minutes.') }, 100));
  const b = ok(addOrigin(f, { kind: 'source', refId: source, ...span(PASTED, 'Built the dispatch console') }, 101));
  // A typed origin points at the fact itself, whatever refId is given.
  const c = ok(addOrigin(f, { kind: 'typed', refId: 0, start: 0, end: 7 }, 102));
  expect(originsOf(f)).toEqual([
    { id: a.id, factId: f, kind: 'talk', refId: turn, ...span(SAID, 'It cut the Monday scramble to ten minutes.'), quote: 'It cut the Monday scramble to ten minutes.', addedAt: 100 },
    { id: b.id, factId: f, kind: 'source', refId: source, ...span(PASTED, 'Built the dispatch console'), quote: 'Built the dispatch console', addedAt: 101 },
    { id: c.id, factId: f, kind: 'typed', refId: f, start: 0, end: 7, quote: 'Cut the', addedAt: 102 },
  ]);
  expect(originsOf(f).map((o) => checkOrigin(o).state)).toEqual(['holds', 'holds', 'holds']);
  expect(removeOrigin(c.id)).toBe(true);
  expect(originsOf(f).length).toBe(2);
});

test('an origin is refused when it is not the owner\'s words or the span is not in the text', () => {
  expect(addOrigin(f, { kind: 'talk', refId: reply, start: 0, end: 3 })).toEqual({ ok: false, error: 'That turn of Talk is not the owner’s.' });
  expect(addOrigin(f, { kind: 'talk', refId: 9999, start: 0, end: 3 })).toEqual({ ok: false, error: 'The text this points at is not in the record.' });
  expect(addOrigin(9999, { kind: 'talk', refId: turn, start: 0, end: 3 })).toEqual({ ok: false, error: 'That fact is not in the record.' });
  for (const [start, end] of [[-1, 3], [5, 5], [6, 2], [0, SAID.length + 1], [0.5, 3]]) {
    expect(addOrigin(f, { kind: 'talk', refId: turn, start, end })).toEqual({ ok: false, error: 'The span is not inside the text.' });
  }
  expect(addOrigin(f, { kind: 'talk', refId: turn, start: 0, end: SAID.length }).ok).toBe(true);
  // A span may not cut a character of two code units in half.
  const emoji = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', 'Shipped it 🚢 on time.', 4) RETURNING id").get() as { id: number }).id;
  expect(addOrigin(f, { kind: 'talk', refId: emoji, start: 0, end: 12 })).toEqual({ ok: false, error: 'The span is not inside the text.' });
  expect(addOrigin(f, { kind: 'talk', refId: emoji, start: 12, end: 14 })).toEqual({ ok: false, error: 'The span is not inside the text.' });
  expect(ok(addOrigin(f, { kind: 'talk', refId: emoji, start: 0, end: 13 })) && originsOf(f).at(-1)!.quote).toBe('Shipped it 🚢');
  // A file's or a repository's body is its name, not the words.
  for (const kind of ['file', 'github', 'repo']) {
    const named = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES (?, 'resume.pdf', 'resume.pdf', 'done', 5) RETURNING id").get(kind) as { id: number }).id;
    expect(addOrigin(f, { kind: 'source', refId: named, start: 0, end: 6 })).toEqual({ ok: false, error: 'Only a source of pasted text holds the words themselves.' });
  }
});

test('the span check: holds, moved, changed and gone', () => {
  const o = { start: 3, end: 8, quote: 'moved' };
  expect(checkSpan('We moved it.', o)).toEqual({ state: 'holds' });
  expect(checkSpan('Then we moved it.', o)).toEqual({ state: 'moved', at: 8 });
  expect(checkSpan('We shifted it.', o)).toEqual({ state: 'changed' });
  expect(checkSpan(null, o)).toEqual({ state: 'gone' });
  // A span past the end of a shorter text does not hold.
  expect(checkSpan('We', o)).toEqual({ state: 'changed' });
});

test('a stored origin is checked against its text as it now stands', () => {
  ok(addOrigin(f, { kind: 'source', refId: source, ...span(PASTED, 'Built the dispatch console') }));
  ok(addOrigin(f, { kind: 'typed', refId: 0, start: 0, end: 7 }));
  ok(addOrigin(f, { kind: 'talk', refId: turn, ...span(SAID, 'ten minutes') }));
  db.query('UPDATE sources SET body = ? WHERE id = ?').run(`Read again. ${PASTED}`, source);
  db.query("UPDATE facts SET text = 'Shortened the Monday rota scramble.' WHERE id = ?").run(f);
  db.query('UPDATE talk SET body = ? WHERE id = ?').run('We moved the depot rota in March. It cut ten minutes.', turn);
  expect(originsOf(f).map((o) => checkOrigin(o))).toEqual([{ state: 'moved', at: span(PASTED, 'Built the dispatch console').start + 12 }, { state: 'changed' }, { state: 'moved', at: 41 }]);
});

test('a deleted Talk turn or source takes the origins and quotes that point at it', () => {
  ok(addOrigin(f, { kind: 'talk', refId: turn, ...span(SAID, 'ten minutes') }));
  ok(addOrigin(f, { kind: 'source', refId: source, ...span(PASTED, 'Built the dispatch console') }));
  ok(addOrigin(f, { kind: 'typed', refId: 0, start: 0, end: 3 }));
  db.query('DELETE FROM sources WHERE id = ?').run(source);
  expect(originsOf(f).map((o) => o.kind)).toEqual(['talk', 'typed']);
  // Forgetting the conversation (lib/talk.ts) is a plain delete of every turn.
  forget();
  expect(originsOf(f).map((o) => o.kind)).toEqual(['typed']);
  expect(db.query("SELECT count(*) AS n FROM fact_origins WHERE quote LIKE '%ten minutes%' OR quote LIKE '%dispatch%'").get()).toEqual({ n: 0 });
  // A new turn that takes a deleted turn's id finds nothing pointing at it.
  const again = (db.query("INSERT INTO talk (id, who, body, created_at) VALUES (?, 'you', 'Another thing entirely.', 9) RETURNING id").get(turn) as { id: number }).id;
  expect(again).toBe(turn);
  expect(originsOf(f).length).toBe(1);
});

const reading = (texts: string[]): Extraction => ({ roles: [], facts: texts.map((text) => ({ roleKey: 'role:1', kind: 'accomplishment', text, detail: '', metric: '', skills: [], evidence: '' })) });
const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;

test('a fact read again with the same words keeps its origins; one with new words loses them', () => {
  applyExtraction(source, reading(['Built the dispatch console.', 'Wrote the rota.']), 10);
  const a = idOf('Built the dispatch console.'), b = idOf('Wrote the rota.');
  ok(addOrigin(a, { kind: 'source', refId: source, ...span(PASTED, 'Built the dispatch console') }, 11));
  ok(addOrigin(a, { kind: 'typed', refId: 0, start: 0, end: 5 }, 12));
  ok(addOrigin(b, { kind: 'talk', refId: turn, ...span(SAID, 'depot rota') }, 13));
  applyExtraction(source, reading(['Built the dispatch console.', 'Wrote the weekly rota.']), 20);
  const a2 = idOf('Built the dispatch console.');
  expect(a2).not.toBe(a);
  expect(originsOf(a2).map((o) => [o.kind, o.refId, o.quote, o.addedAt])).toEqual([['source', source, 'Built the dispatch console', 11], ['typed', a2, 'Built', 12]]);
  expect(originsOf(a2).map((o) => checkOrigin(o).state)).toEqual(['holds', 'holds']);
  expect(originsOf(idOf('Wrote the weekly rota.'))).toEqual([]);
  expect(db.query("SELECT count(*) AS n FROM fact_origins WHERE quote = 'depot rota'").get()).toEqual({ n: 0 });
});

test('a fold moves the duplicates\' Talk and source origins to the fact that stays', () => {
  const dup = fact(1, 'Cut the Monday scramble.');
  ok(addOrigin(dup, { kind: 'talk', refId: turn, ...span(SAID, 'ten minutes') }));
  ok(addOrigin(dup, { kind: 'typed', refId: 0, start: 0, end: 3 }));
  db.transaction(() => { foldFacts(f, [dup]); db.query('DELETE FROM facts WHERE id = ?').run(dup); })();
  expect(originsOf(f).map((o) => [o.kind, o.quote])).toEqual([['talk', 'ten minutes']]);
  expect(originsOf(dup)).toEqual([]);
});

test('the module is safe to import alone, on a database where Talk has no table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egg-origins-alone-'));
  try {
    const script = `const o = await import(${JSON.stringify(join(import.meta.dir, 'origins.ts'))});
      const { db } = await import(${JSON.stringify(join(import.meta.dir, 'db.ts'))});
      const f = db.query("INSERT INTO facts (id, kind, text, created_at) VALUES (1, 'other', 'Alone.', 1) RETURNING id").get().id;
      console.log(JSON.stringify([o.originText('talk', 1), o.addOrigin(f, { kind: 'talk', refId: 1, start: 0, end: 2 }), o.addOrigin(f, { kind: 'typed', refId: 0, start: 0, end: 5 }).ok]));`;
    const p = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, DB: join(dir, 'alone.db') }, stdout: 'pipe', stderr: 'pipe' });
    expect(p.stderr.toString()).toBe('');
    expect(JSON.parse(p.stdout.toString().trim().split('\n').at(-1)!)).toEqual([null, { ok: false, error: 'The text this points at is not in the record.' }, true]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a deleted fact takes its origins and their copied words with it', () => {
  ok(addOrigin(f, { kind: 'talk', refId: turn, ...span(SAID, 'ten minutes') }));
  ok(addOrigin(f, { kind: 'typed', refId: 0, start: 0, end: 3 }));
  const other = fact(1, 'Ran the weekly planning call.');
  ok(addOrigin(other, { kind: 'source', refId: source, start: 0, end: 5 }));
  deleteFact(f, 10);
  expect(db.query('SELECT count(*) AS n FROM fact_origins WHERE fact_id = ?').get(f)).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM fact_origins WHERE quote LIKE '%ten minutes%'").get()).toEqual({ n: 0 });
  // Another fact's origin stays.
  expect(originsOf(other).length).toBe(1);
});
