// `bun test lib`: folding duplicate facts (lib/dedupe.ts) carries what is kept for each dropped fact to the fact that
// stays: a kept mark (lib/standing.ts) and the words a fact came from (lib/origins.ts). The model is a stand-in
// (fakeAsk in lib/llm.ts), and the people and companies are invented (lib/scratch.ts).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { dedupe } from './dedupe.ts';
import { fakeAsk } from './llm.ts';
import { db, fact, reset, role } from './scratch.ts';
import { addOrigin, originsOf } from './origins.ts';
import { factMark, setFactMark, toolMarks } from './standing.ts';

beforeEach(() => {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
});
afterEach(() => fakeAsk());

test('a kept duplicate makes the fact that stays kept, with the reason, and its Talk words move with it', async () => {
  const stays = fact(1, 'Built the dispatch console.');
  const dup = fact(1, 'Built the dispatch console for 640 schedulers.');
  const other = fact(1, 'Ran the weekly planning call.');
  expect(setFactMark(dup, 'kept')).toBe('');
  const turn = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', 'It is used by 640 schedulers.', 1) RETURNING id").get() as { id: number }).id;
  expect(addOrigin(dup, { kind: 'talk', refId: turn, start: 14, end: 28 }).ok).toBe(true);
  fakeAsk(() => ({ merges: [{ keep: stays, drop: [dup], text: 'Built the dispatch console for 640 schedulers.', detail: '', metric: '640 schedulers', skills: [] }] }));
  expect(await dedupe()).toBe(1);
  expect(db.query('SELECT id FROM facts ORDER BY id').all()).toEqual([{ id: stays }, { id: other }]);
  expect(factMark(stays)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(toolMarks().map((m) => [m.factId, m.reason, m.refId, m.refName])).toEqual([[stays, 'folded-kept-duplicate', dup, 'Built the dispatch console for 640 schedulers.']]);
  expect(originsOf(stays).map((o) => [o.kind, o.quote])).toEqual([['talk', '640 schedulers']]);
  expect(factMark(other).mark).toBe('documents');
});

test('a fold with nothing kept marks nothing', async () => {
  const stays = fact(1, 'Cut the billing run.'), dup = fact(1, 'Cut the nightly billing run.');
  fakeAsk(() => ({ merges: [{ keep: stays, drop: [dup], text: 'Cut the nightly billing run.', detail: '', metric: '', skills: [] }] }));
  expect(await dedupe()).toBe(1);
  expect(factMark(stays)).toEqual({ mark: 'documents', from: 'default', by: '' });
  expect(toolMarks()).toEqual([]);
});
