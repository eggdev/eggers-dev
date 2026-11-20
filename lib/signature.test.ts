// `bun test lib`: the record's signature (bankSignature in lib/db.ts) once projects and the new fact fields reach the
// resume writer, and the 15-minute hold (lib/raised.ts, holdSince) after each change that moves it. A change to the
// signature writes every unsent resume again, so it must move for what the writer is given, and only for that.
// On a scratch database with an invented person (lib/scratch.ts).
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { bankSignature, profileSignature, saidValue } from './db.ts';
import { fakeAsk } from './llm.ts';
import { answer, choiceAt, holdSince, lastAnswerAt, lastHandWriteAt, openRaised } from './raised.ts';
import { decideResult, keepProposal, proposalsOf, proposeFor } from './propose.ts';
import { judge } from './derived.ts';
import { derivedNow } from './record.ts';
import { syncRecordQuestions } from './gaps.ts';

// The signature by the rule before projects of roles reached the writer: facts, roles, and a role's note and label once set.
// It is also what the profile is written from (lib/db.ts, profileSignature).
function before(): string {
  const facts = db.query('SELECT id, role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all();
  const roles = db.query('SELECT id, company, title, start, end, standing, reach, part_of FROM roles ORDER BY id').all();
  const said = db.query("SELECT id, note, label FROM roles WHERE note != '' OR label != '' ORDER BY id").all();
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(said.length ? [facts, roles, said] : [facts, roles])).digest('hex').slice(0, 24);
}
const project = (roleId: number | null, title: string, viaRole: number | null = null) =>
  (db.query('INSERT INTO projects (role_id, via_role, title, created_at) VALUES (?, ?, ?, 1) RETURNING id').get(roleId, viaRole, title) as { id: number }).id;
const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;
const CONSOLE = 'Built the dispatch console that schedulers use every day.', BILLING = 'Cut the nightly billing run.';

beforeEach(() => { seed(); fakeAsk(); });

test('with no project of a role filled or filed and no new fact field, the signature is the one the old rule gives', () => {
  expect(bankSignature()).toBe(before());
  // Stage 2 shaped: a project of a role with a name and no fact, a repository's project, what was learned and where a
  // project lives, a role's source marks, a verdict on a line, suggestions open and rejected, a note on a role.
  const empty = project(1, 'Nothing filed yet');
  db.query("UPDATE projects SET context = 'A plan.', learning = 'Patience.', lives = 'example.org' WHERE id = ?").run(empty);
  db.run("INSERT INTO roles (id, company, title, part_of) VALUES (9, 'harborlight/dispatch', '', 1)");
  project(null, '', 9);
  db.run(`UPDATE roles SET official = '{"title":"hr"}', note = 'Hands-on lead.' WHERE id = 1`);
  fact(1, 'Managed a team of 5 engineers.');
  expect(judge(derivedNow(), 'led', 'kept', 1)).toBe('');
  db.run("INSERT INTO project_proposals (role_id, title, fact_ids, status, created_at) VALUES (1, 'Open one', '[]', 'open', 1), (1, 'Rejected one', '[]', 'rejected', 1)");
  // "There was none" and "I don't know" are not values: they are not sent, and they do not count.
  db.query("UPDATE facts SET baseline = 'There was none', own_part = 'I don’t know' WHERE id = ?").run(idOf(CONSOLE));
  expect(bankSignature()).toBe(before());
});

test('it changes when a fact is filed in or taken out of a project of a role, and for that project\'s name and parts and a fact\'s new fields', () => {
  // Each change is measured against the signature just before it (taking a fact out again returns to an earlier one).
  const p = project(1, 'Dispatch console');
  let last = bankSignature();
  const changes = (what: string, run: () => void) => { run(); const s = bankSignature(); expect([what, s === last]).toEqual([what, false]); last = s; };
  changes('a fact filed in a project of its role', () => db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(p, idOf(CONSOLE)));
  changes('a second fact filed there', () => db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(p, idOf(BILLING)));
  changes('one taken out again', () => db.query('UPDATE facts SET project_id = NULL WHERE id = ?').run(idOf(BILLING)));
  changes('the project’s name', () => db.query("UPDATE projects SET title = 'One console' WHERE id = ?").run(p));
  changes('its context', () => db.query("UPDATE projects SET context = 'Schedulers planned on paper.' WHERE id = ?").run(p));
  changes('its action', () => db.query("UPDATE projects SET action = 'I wrote it alone.' WHERE id = ?").run(p));
  // With CARL the writer is given a project's learning, so it counts.
  changes('its learning', () => db.query("UPDATE projects SET learning = 'To ship weekly.' WHERE id = ?").run(p));
  changes('its result', () => db.query("UPDATE projects SET result = 'Every depot on one screen.' WHERE id = ?").run(p));
  changes('a fact’s baseline', () => db.query("UPDATE facts SET baseline = '9 hours' WHERE id = ?").run(idOf(BILLING)));
  changes('its team', () => db.query("UPDATE facts SET team = 'about 4 people' WHERE id = ?").run(idOf(BILLING)));
  changes('its own part', () => db.query("UPDATE facts SET own_part = 'I wrote the scheduler.' WHERE id = ?").run(idOf(BILLING)));
  // The last fact taken out of the project: back to what it was with the fields alone.
  changes('the last fact taken out', () => db.query('UPDATE facts SET project_id = NULL WHERE id = ?').run(idOf(CONSOLE)));
});

test('it does not change for where a project lives, source marks, a verdict, or a suggestion not kept', () => {
  const p = project(1, 'Dispatch console');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(p, idOf(CONSOLE));
  fact(1, 'Managed a team of 5 engineers.');
  const sig = bankSignature();
  db.query("UPDATE projects SET lives = 'console.example' WHERE id = ?").run(p);
  db.run(`UPDATE roles SET official = '{"title":"hr","start":"memory"}' WHERE id = 1`);
  expect(judge(derivedNow(), 'led', 'kept', 1)).toBe('');
  db.run("INSERT INTO project_proposals (role_id, title, fact_ids, status, created_at) VALUES (1, 'Open one', '[]', 'open', 1), (1, 'Rejected one', '[]', 'rejected', 1)");
  // A part answered "I don't know" writes nothing; a baseline of "There was none" is not sent.
  db.query("UPDATE facts SET baseline = 'There was none' WHERE id = ?").run(idOf(CONSOLE));
  expect(bankSignature()).toBe(sig);
});

test('every action that moves the signature also starts the 15-minute hold', async () => {
  // Six facts in Day to day at Harborlight, for a suggestion to be kept.
  for (let i = 0; i < 4; i++) fact(1, `Ran the invented review number ${i}.`);
  const day = (db.query('SELECT id FROM facts WHERE role_id = 1 ORDER BY id').all() as { id: number }[]).map((f) => `fact:${f.id}`);
  fakeAsk(() => ({ projects: [{ title: 'Console work', facts: [day[0], day[1]], result: day[0] }, { title: 'Review rounds', facts: [day[3], day[4]], result: '' }] }));
  await proposeFor(1, '.', () => 100);
  const [a, b] = proposalsOf(1);
  // Keep.
  let sig = bankSignature();
  expect(keepProposal(Number(a.id), {}, 1_000).ok).toBe(true);
  expect([bankSignature() !== sig, lastHandWriteAt()]).toEqual([true, 1_000]);
  // Use it as the result.
  sig = bankSignature();
  expect(decideResult(Number(a.id), true, 2_000).ok).toBe(true);
  expect([bankSignature() !== sig, lastHandWriteAt()]).toEqual([true, 2_000]);
  // Edit, then Keep.
  sig = bankSignature();
  expect(keepProposal(Number(b.id), { title: 'Weekly reviews', facts: [Number(day[3].slice(5)), Number(day[4].slice(5))] }, 3_000).ok).toBe(true);
  expect([bankSignature() !== sig, lastHandWriteAt()]).toEqual([true, 3_000]);
  // The answers to a part, a baseline and an own part question. An unsent job names the console as its best evidence.
  db.query("UPDATE projects SET result = '' WHERE role_id = 1").run();
  db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Nimbus Yard', 'done', ?, '# A resume', 1, '')")
    .run(JSON.stringify({ requirements: [{ text: 'Dispatch', need: 'must', coverage: 'strong', evidence: '', best: `fact:${idOf(CONSOLE)}` }] }));
  syncRecordQuestions(4_000);
  const keys = openRaised().filter((q) => q.kind === 'record').map((q) => q.key);
  const part = keys.find((k) => k.startsWith('record:part:') && k.endsWith(':result'))!, base = `record:baseline:${idOf(CONSOLE)}`, own = `record:own:${idOf(CONSOLE)}`;
  expect(keys).toEqual(expect.arrayContaining([part, base, own]));
  let at = 5_000;
  for (const [key, value] of [[part, 'Every depot on one screen.'], [base, 'none of it on screen'], [own, 'I wrote the scheduler.']] as const) {
    sig = bankSignature();
    expect(answer(key, 0, value, at, choiceAt(key, 0))).toBe('');
    expect([key, bankSignature() !== sig, lastAnswerAt(), holdSince()]).toEqual([key, true, at, at]);
    at += 1_000;
  }
});

test('an answer that says nothing is no value, in any spelling; a real answer is kept', () => {
  for (const nothing of ['There was none', 'There was none.', 'none', 'None.', 'I don’t know', "I don't know", 'i DON\'T know', 'Don’t know', "don't know", 'dont know', 'Dont Know',
    'I do not know', 'no idea', 'No idea.', 'There wasn’t one', "there wasn't one", 'there was not one', 'not applicable', 'Not applicable.', 'N/A', 'n/a', 'TBD', 'tbd', '?', 'unknown', 'Unknown.',
    'Not sure.', 'I don’t remember', '-', '—', ' '])
    expect([nothing, saidValue(nothing)]).toEqual([nothing, undefined]);
  for (const real of ['0', 'none of it was mine', 'Nothing, it was new', 'about 40 people', '9 hours', 'None of it'])
    expect([real, saidValue(real)]).toEqual([real, real]);
  // For the owner's own part only, a bare "None" is an answer: they did none of it.
  for (const none of ['None', 'none.', 'Nothing']) expect([none, saidValue(none, 'own_part')]).toEqual([none, none]);
  expect(saidValue('I don’t know', 'own_part')).toBeUndefined();
});

test('the profile is written from what it reads: filing a fact or a fact\'s new field does not make it out of date', () => {
  // On the data as it was, the profile's part is the whole signature, so no stored profile turns stale at deploy.
  expect(profileSignature()).toBe(bankSignature());
  expect(profileSignature()).toBe(before());
  const p = project(1, 'Dispatch console'), was = profileSignature();
  db.query('UPDATE facts SET project_id = ?, baseline = ? WHERE id = ?').run(p, '9 hours', idOf(CONSOLE));
  expect(bankSignature()).not.toBe(was);
  expect(profileSignature()).toBe(was);
  // What the profile does read still moves it.
  db.query("UPDATE facts SET text = 'Built the dispatch console that every depot uses.' WHERE id = ?").run(idOf(CONSOLE));
  expect(profileSignature()).not.toBe(was);
});
