// `bun test lib`: dates and state of work, visibility marks and the rank of projects (lib/standing.ts), on a scratch
// database with invented people and companies (lib/scratch.ts).
import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { applyExtraction, carryFacts, deleteFact, foldFacts, HeldReading, norm, type Extraction } from './db.ts';
import { factRef } from './tree.ts';
import { DB_FILE } from './paths.ts';
import { db, fact, reset, role } from './scratch.ts';
import { syncProjects } from './projects.ts';
import { addFact, deleteProject, patchFact, patchRole } from './record.ts';
import { recordRepo } from './repoactivity.ts';
import { SURFACES } from './rules.ts';
import {
  allows, clearToolMark, clearToolMarks, factMark, factWhen, markFactsPublic, MARKS, mayUse, monthsWorked, placed, placeProject, projectMark, projectOfFact,
  projectStanding, publicOffered, rank, rankItems, setFactMark, setFactMonth, setProjectMark, setProjectWork, toolMarks, triggerKey, type ProjectMark, type RankItem,
} from './standing.ts';

let console1 = 0, undated = 0, tidepool = 0, source = 0;
let inProject = 0, dayToDay = 0, inCarried = 0, general = 0, inUndated = 0;

beforeEach(() => {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  // A side project: a `roles` row its project points at (via_role), carrying the project's name and dates.
  role({ id: 10, company: 'Tidepool Tide Tables', title: '', start: '2023-05', end: '2024-02', standing: 'personal' });
  syncProjects(1);
  tidepool = (db.query('SELECT id FROM projects WHERE via_role = 10').get() as { id: number }).id;
  console1 = (db.query("INSERT INTO projects (role_id, title, start, end) VALUES (1, 'Dispatch console', '2022-01', '2023-06') RETURNING id").get() as { id: number }).id;
  undated = (db.query("INSERT INTO projects (role_id, title) VALUES (2, 'Quoting rewrite') RETURNING id").get() as { id: number }).id;
  inProject = fact(1, 'Built the dispatch console.');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, inProject);
  dayToDay = fact(1, 'Ran the weekly planning call.');
  inCarried = fact(10, 'Published tide tables for 40 harbours.');
  general = fact(null, 'Speaks conversational Icelandic.');
  inUndated = fact(2, 'Cut quoting latency.');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(undated, inUndated);
  source = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Notes', 'Notes about the tide tables.', 'done', 3) RETURNING id").get() as { id: number }).id;
});

const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number } | null)?.id ?? -1;
const reading = (facts: { text: string; roleKey?: string; detail?: string; replaces?: string }[]): Extraction =>
  ({ roles: [], facts: facts.map((f) => ({ roleKey: f.roleKey ?? 'role:10', kind: 'accomplishment', text: f.text, detail: f.detail ?? '', metric: '', skills: [], evidence: '', ...(f.replaces ? { replaces: f.replaces } : {}) })) });
const offered = () => publicOffered().map((f) => f.id);

// ---------- Visibility ----------

test('nothing is public until the owner marks that fact: not a project, not a later fact, not a rewording', () => {
  for (const f of [inProject, dayToDay, inCarried, general]) expect(factMark(f)).toEqual({ mark: 'documents', from: 'default', by: '' });
  expect(offered()).toEqual([]);
  // A project is never public.
  expect(setProjectMark(console1, 'public' as ProjectMark)).toBe('A project is not marked public. Mark its facts public, one by one or all at once.');
  // Marking a project's facts public marks the ones in it now, one by one.
  expect(markFactsPublic(console1)).toEqual({ ok: true, marked: [inProject] });
  expect(factMark(inProject)).toEqual({ mark: 'public', from: 'fact', by: 'owner' });
  expect(offered()).toEqual([inProject]);
  // A fact added to the project later, and a fact moved into it, are not public.
  const later = fact(1, 'Added the depot map.');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, later);
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, dayToDay);
  for (const f of [later, dayToDay]) expect(factMark(f).mark).toBe('documents');
  expect(offered()).toEqual([inProject]);
  // A fact reworded after it was marked keeps its mark but is not offered until the owner marks it again.
  db.query("UPDATE facts SET detail = 'Named the depot managers.' WHERE id = ?").run(inProject);
  expect(factMark(inProject).mark).toBe('public');
  expect(offered()).toEqual([]);
  expect(setFactMark(inProject, 'public')).toBe('');
  expect(offered()).toEqual([inProject]);
  db.query("UPDATE facts SET text = 'Built the dispatch console for Lakeport Freight.' WHERE id = ?").run(inProject);
  expect(offered()).toEqual([]);
});

test('a public fact reworded by a later reading, through replaces, is not offered', () => {
  applyExtraction(source, reading([{ text: 'Published tide tables.' }]), 10);
  const a = idOf('Published tide tables.');
  expect(setFactMark(a, 'public')).toBe('');
  expect(offered()).toEqual([a]);
  const other = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'More', 'x', 'done', 4) RETURNING id").get() as { id: number }).id;
  applyExtraction(other, reading([{ text: 'Published tide tables for a named client under contract.', replaces: `fact:${a}` }]), 20);
  expect(factMark(a).mark).toBe('public');
  expect(offered()).toEqual([]);
});

test('the public assistant may never read a fact live; documents surfaces follow the mark', () => {
  const want: Record<string, Record<string, boolean>> = {
    public: { resume: true, profile: true, message: true, answer: false },
    documents: { resume: true, profile: true, message: true, answer: false },
    kept: { resume: false, profile: false, message: false, answer: false },
  };
  for (const m of MARKS) for (const s of SURFACES) expect([m, s, allows(m, s)]).toEqual([m, s, want[m][s]]);
  for (const m of MARKS) {
    expect(setFactMark(general, m)).toBe('');
    for (const s of SURFACES) expect([m, s, mayUse(general, s)]).toEqual([m, s, want[m][s]]);
  }
  expect(mayUse(9999, 'resume')).toBe(false);
});

test('kept wins at every level: a fact\'s own public or documents never overrides a kept project', () => {
  expect(setFactMark(inProject, 'public')).toBe('');
  expect(setFactMark(dayToDay, 'documents')).toBe('');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, dayToDay);
  expect(setProjectMark(console1, 'kept')).toBe('');
  for (const f of [inProject, dayToDay]) {
    expect(factMark(f)).toEqual({ mark: 'kept', from: 'project', by: '' });
    for (const s of SURFACES) expect(mayUse(f, s)).toBe(false);
  }
  expect(offered()).toEqual([]);
  // A fact's own kept wins over an unmarked project, and a project's documents mark is shown as the project's.
  expect(setFactMark(general, 'kept')).toBe('');
  expect(factMark(general)).toEqual({ mark: 'kept', from: 'fact', by: 'owner' });
  expect(setProjectMark(undated, 'documents')).toBe('');
  expect(factMark(inUndated)).toEqual({ mark: 'documents', from: 'project', by: '' });
  // A fact of a carried project (side project) is kept through its role row.
  expect(projectOfFact(inCarried)).toBe(tidepool);
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  expect(factMark(inCarried)).toEqual({ mark: 'kept', from: 'project', by: '' });
  // A kept project's facts are not marked public all at once.
  expect(markFactsPublic(console1)).toEqual({ ok: false, error: 'That project is kept. Change its mark first.' });
});

test('marks are refused for rows not in the record and for unknown values', () => {
  expect(setFactMark(9999, 'public')).toBe('That fact is not in the record.');
  expect(setProjectMark(9999, 'kept')).toBe('That project is not in the record.');
  expect(setFactMark(general, 'everyone' as 'public')).toBe('That is not a mark.');
  expect(markFactsPublic(9999)).toEqual({ ok: false, error: 'That project is not in the record.' });
});

// ---------- kept survives changes to the record's structure ----------

test('a kept project deleted with its facts kept leaves them kept', () => {
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(deleteProject(console1, 'keep', 5).ok).toBe(true);
  expect(factMark(inProject)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(mayUse(inProject, 'resume')).toBe(false);
  // The same for a carried project: its facts go back to General and stay kept.
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  expect(deleteProject(tidepool, 'keep', 6).ok).toBe(true);
  expect(factMark(inCarried)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
});

test('a fact moved out of a kept project, by hand or by Talk, stays kept', () => {
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  expect(patchFact(inCarried, { roleId: 1, projectId: '' }, 6).ok).toBe(true);
  expect(db.query('SELECT role_id, project_id FROM facts WHERE id = ?').get(inCarried)).toEqual({ role_id: 1, project_id: null });
  expect(factMark(inCarried)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(mayUse(inCarried, 'resume')).toBe(false);
  // A write that names the columns without changing them marks nothing.
  db.query('UPDATE facts SET role_id = role_id WHERE id = ?').run(dayToDay);
  expect(factMark(dayToDay).mark).toBe('documents');
  // Moved to another role (as Talk's correction does) out of a kept native project.
  expect(setProjectMark(console1, 'kept')).toBe('');
  db.query('UPDATE facts SET role_id = 2, project_id = NULL WHERE id = ?').run(inProject);
  expect(factMark(inProject)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
});

test('a kept side project whose row is given a title, and so becomes a role, keeps its facts kept', () => {
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  expect(patchRole(10, { title: 'Founder', employment: 'own' }, 7).ok).toBe(true);
  expect(projectOfFact(inCarried)).toBe(null);
  expect(factMark(inCarried).mark).toBe('kept');
  expect(mayUse(inCarried, 'resume')).toBe(false);
  // The row removed and its project with it (lib/projects.ts): the facts are kept by their own mark.
  db.run('DELETE FROM roles WHERE id = 10');
  syncProjects(8);
  expect(factMark(inCarried)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
});

// ---------- kept survives a reading again and a fold ----------

test('a fact read again with the same words keeps its mark, month and approval under its new id', () => {
  applyExtraction(source, reading([{ text: 'Named the private client behind the tide tables.' }, { text: 'Published tide tables.' }]), 10);
  const a = idOf('Named the private client behind the tide tables.'), b = idOf('Published tide tables.');
  expect(setFactMark(a, 'kept')).toBe('');
  expect(setFactMonth(a, '2023-09')).toBe('');
  expect(setFactMark(b, 'public')).toBe('');
  applyExtraction(source, reading([{ text: 'named the private client  behind the tide tables.' }, { text: 'Published tide tables.' }]), 20);
  const a2 = idOf('named the private client  behind the tide tables.'), b2 = idOf('Published tide tables.');
  expect([a2 !== a, b2 !== b]).toEqual([true, true]);
  expect(factMark(a2)).toEqual({ mark: 'kept', from: 'fact', by: 'owner' });
  expect(factWhen(a2)).toEqual({ start: '2023-09', end: '2023-09', from: 'fact' });
  expect(mayUse(a2, 'resume')).toBe(false);
  expect(offered()).toEqual([b2]);
  // The approval is copied, not made again: a reading that changes the detail is not offered.
  applyExtraction(source, reading([{ text: 'named the private client  behind the tide tables.' }, { text: 'Published tide tables.', detail: 'For Lakeport harbour.' }]), 30);
  expect(factMark(idOf('Published tide tables.')).mark).toBe('public');
  expect(offered()).toEqual([]);
  // A mark never changes a fact's status.
  expect(db.query('SELECT status FROM facts WHERE id = ?').get(idOf('Published tide tables.'))).toEqual({ status: 'proposed' });
});

test('a fact kept by its project is written kept when it is read again outside that project', () => {
  applyExtraction(source, reading([{ text: 'Shipped the depot rota.', roleKey: 'role:1' }]), 10);
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, idOf('Shipped the depot rota.'));
  expect(setProjectMark(console1, 'kept')).toBe('');
  applyExtraction(source, reading([{ text: 'Shipped the depot rota.', roleKey: 'role:1' }]), 20);
  const again = idOf('Shipped the depot rota.');
  expect(db.query('SELECT project_id FROM facts WHERE id = ?').get(again)).toEqual({ project_id: null });
  expect(factMark(again)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
});

// What the database holds for every fact, to show that a held reading changed nothing.
const snapshot = () => ({
  facts: db.query('SELECT id, text, role_id, project_id, status FROM facts ORDER BY id').all(),
  standing: db.query('SELECT * FROM fact_standing ORDER BY fact_id').all(),
});
const ordinary = Array.from({ length: 20 }, (_, i) => ({ text: `Ordinary fact number ${i} about the tide tables.`, roleKey: 'role:1' }));
const resumeReady = () => (db.query('SELECT id FROM facts').all() as { id: number }[]).filter((f) => mayUse(f.id, 'resume')).length;

test('a reading again that rewords a kept fact is held: nothing changes, and the error says which fact', () => {
  applyExtraction(source, reading([{ text: 'Named the private client behind the tide tables.' }, ...ordinary]), 10);
  const kept = idOf('Named the private client behind the tide tables.');
  expect(setFactMark(kept, 'kept')).toBe('');
  expect(setFactMonth(kept, '2023-09')).toBe('');
  const before = snapshot();
  expect(resumeReady()).toBe(20 + 5);
  let held: unknown;
  try { applyExtraction(source, reading([{ text: 'Named Lakeport as the private client behind the tide tables.' }, ...ordinary]), 20); } catch (e) { held = e; }
  expect(held).toBeInstanceOf(HeldReading);
  expect({ sourceId: (held as HeldReading).sourceId, kept: (held as HeldReading).kept }).toEqual({ sourceId: source, kept: [{ id: kept, text: 'Named the private client behind the tide tables.' }] });
  expect(snapshot()).toEqual(before);
  expect(resumeReady()).toBe(20 + 5);
  expect(toolMarks()).toEqual([]);
});

test('a reading again that leaves a kept fact out is held too', () => {
  applyExtraction(source, reading([{ text: 'Private thing.' }, { text: 'Public thing one.', roleKey: 'role:1' }]), 10);
  expect(setFactMark(idOf('Private thing.'), 'kept')).toBe('');
  const before = snapshot();
  expect(() => applyExtraction(source, reading([{ text: 'Public thing one.', roleKey: 'role:1' }, { text: 'Public thing two.', roleKey: 'role:1' }]), 20)).toThrow(HeldReading);
  expect(snapshot()).toEqual(before);
  // A fact kept only through its project holds a reading the same way.
  applyExtraction(source, reading([{ text: 'Private thing.' }, { text: 'Shipped the depot rota.', roleKey: 'role:1' }]), 30);
  expect(setFactMark(idOf('Private thing.'), '')).toBe('');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, idOf('Shipped the depot rota.'));
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(() => applyExtraction(source, reading([{ text: 'Private thing.' }]), 40)).toThrow(HeldReading);
  // Two kept facts with the same words need two successors.
  expect(setProjectMark(console1, '')).toBe('');
  applyExtraction(source, reading([{ text: 'Twice said.' }, { text: 'twice  said.' }]), 50);
  for (const t of ['Twice said.', 'twice  said.']) expect(setFactMark(idOf(t), 'kept')).toBe('');
  expect(() => applyExtraction(source, reading([{ text: 'Twice said.' }, { text: 'Something new.', roleKey: 'role:1' }]), 60)).toThrow(HeldReading);
  // With one successor and nothing else, everything the reading writes is kept: it goes through.
  expect(applyExtraction(source, reading([{ text: 'Twice said.' }]), 65)).toBe(1);
  expect(factMark(idOf('Twice said.')).mark).toBe('kept');
  expect(applyExtraction(source, reading([{ text: 'Twice said.' }, { text: 'TWICE said.' }]), 70)).toBe(2);
  expect(['Twice said.', 'TWICE said.'].map((t) => factMark(idOf(t)).mark)).toEqual(['kept', 'kept']);
});

test('the owner settles a held reading by clearing the old mark; the reading then goes through and marks nothing', () => {
  applyExtraction(source, reading([{ text: 'Named the private client.' }, ...ordinary]), 10);
  expect(setFactMark(idOf('Named the private client.'), 'kept')).toBe('');
  expect(() => applyExtraction(source, reading([{ text: 'Named Lakeport as the client.' }, ...ordinary]), 20)).toThrow(HeldReading);
  expect(setFactMark(idOf('Named the private client.'), '')).toBe('');
  expect(applyExtraction(source, reading([{ text: 'Named Lakeport as the client.' }, ...ordinary]), 30)).toBe(21);
  expect(toolMarks()).toEqual([]);
  // Then marks the new wording kept itself.
  expect(setFactMark(idOf('Named Lakeport as the client.'), 'kept')).toBe('');
  expect(resumeReady()).toBe(20 + 5);
});

// A carrier for this test alone: while `probe` is set, it runs it inside the reading, after the reading's first read.
let probe: (() => void) | undefined;
carryFacts({ table: 'test_probe', reread: () => { probe?.(); return { held: () => [], carry: () => {} }; }, fold: () => {} });

test('a reading takes the write lock before it reads, so another writer waits instead of making it fail', () => {
  applyExtraction(source, reading([{ text: 'Published tide tables.' }]), 10);
  const other = new Database(DB_FILE);
  other.run('PRAGMA busy_timeout = 0');
  let seen = '';
  probe = () => { try { other.run('INSERT INTO answered (question, at) VALUES (\'From another connection.\', 1)'); seen = 'wrote'; } catch (e) { seen = (e as Error).message; } };
  try { applyExtraction(source, reading([{ text: 'Published tide tables.' }]), 20); } finally { probe = undefined; other.close(); }
  expect(seen).toBe('database is locked');
});

test('with none of the new modules loaded, a reading again replaces its facts as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egg-plain-reading-'));
  try {
    const script = `const d = await import(${JSON.stringify(join(import.meta.dir, 'db.ts'))});
      d.db.run("INSERT INTO sources (id, kind, title, body, status, created_at) VALUES (1, 'text', 'Notes', 'x', 'done', 1)");
      const x = (t) => ({ roles: [], facts: [{ roleKey: '', kind: 'accomplishment', text: t, detail: '', metric: '', skills: [], evidence: '' }] });
      const n = [d.applyExtraction(1, x('Wrote the first draft.'), 1), d.applyExtraction(1, x('Wrote the second draft.'), 2)];
      const tables = d.db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('fact_standing', 'fact_origins')").all();
      console.log(JSON.stringify([n, d.db.query('SELECT text FROM facts').all(), tables]));`;
    const p = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, DB: join(dir, 'plain.db') }, stdout: 'pipe', stderr: 'pipe' });
    expect(p.stderr.toString()).toBe('');
    expect(JSON.parse(p.stdout.toString().trim().split('\n').at(-1)!)).toEqual([[1, 1], [{ text: 'Wrote the second draft.' }], []]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same words as a kept fact, from another source, are kept too, with the reason', () => {
  applyExtraction(source, reading([{ text: 'Named the private client.' }]), 10);
  const kept = idOf('Named the private client.');
  expect(setFactMark(kept, 'kept')).toBe('');
  const other = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'More', 'x', 'done', 4) RETURNING id").get() as { id: number }).id;
  applyExtraction(other, reading([{ text: 'Named the  PRIVATE client.' }, { text: 'Drew the harbour map.' }]), 20);
  const copy = idOf('Named the  PRIVATE client.');
  expect(factMark(copy)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(factMark(idOf('Drew the harbour map.')).mark).toBe('documents');
  expect(toolMarks().map(({ at, ...m }) => [m, at > 0])).toEqual([[{ factId: copy, words: 'Named the  PRIVATE client.', reason: 'same-words-as-kept', refId: kept, refName: 'Named the private client.' }, true]]);
  // A fact kept by its project counts the same.
  const mine = fact(1, 'Priced the Lakeport contract.');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, mine);
  expect(setProjectMark(console1, 'kept')).toBe('');
  const third = (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'Third', 'x', 'done', 5) RETURNING id").get() as { id: number }).id;
  applyExtraction(third, reading([{ text: 'Priced the Lakeport contract.' }]), 30);
  const priced = (db.query('SELECT id FROM facts WHERE text = ? AND id != ?').get('Priced the Lakeport contract.', mine) as { id: number }).id;
  expect(factMark(priced)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
});

test('every mark the tool sets says why; the owner sees them and clears a group in one call', () => {
  // Facts that left a kept project: by hand, and by its deletion with its facts kept.
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  const second = fact(10, 'Measured the tide gauges.');
  expect(patchFact(inCarried, { roleId: 1, projectId: '' }, 6).ok).toBe(true);
  expect(setProjectMark(console1, 'kept')).toBe('');
  db.query('DELETE FROM projects WHERE id = ?').run(console1);
  const why = () => toolMarks().map((m) => [m.factId, m.reason, m.refId, m.refName]);
  expect(why()).toEqual([[inProject, 'kept-project-deleted', console1, 'Dispatch console'], [inCarried, 'left-kept-project', tidepool, 'Tidepool Tide Tables']]);
  expect(toolMarks().every((m) => m.at > 0)).toBe(true);
  // Clearing the project's own mark changes no fact the tool marked: they stay listed.
  expect(setProjectMark(tidepool, '')).toBe('');
  expect(factMark(inCarried)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(factMark(second).mark).toBe('documents');
  expect(why().map((w) => w[0])).toEqual([inProject, inCarried]);
  // One call clears the group; one clears a single mark; a mark the owner set is never touched.
  expect(clearToolMarks('left-kept-project', tidepool)).toBe(1);
  expect(factMark(inCarried)).toEqual({ mark: 'documents', from: 'default', by: '' });
  expect(setFactMark(general, 'kept')).toBe('');
  expect(clearToolMark(general)).toBe(false);
  expect(clearToolMark(inProject)).toBe(true);
  expect(toolMarks()).toEqual([]);
  expect(factMark(general).by).toBe('owner');
  // A dropped duplicate that was kept.
  const stays = fact(1, 'Built the console.'), dup = fact(1, 'Built the console again.');
  expect(setFactMark(dup, 'kept')).toBe('');
  db.transaction(() => { foldFacts(stays, [dup]); db.query('DELETE FROM facts WHERE id = ?').run(dup); })();
  expect(why()).toEqual([[stays, 'folded-kept-duplicate', dup, 'Built the console again.']]);
  // The owner's own mark on a fact replaces the tool's, and its reason.
  expect(setFactMark(stays, 'kept')).toBe('');
  expect(toolMarks()).toEqual([]);
});

test('a process that has the tables but not the modules refuses to read a source again or fold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egg-carriers-'));
  try {
    const script = `const d = await import(${JSON.stringify(join(import.meta.dir, 'db.ts'))});
      d.db.run("CREATE TABLE fact_standing (fact_id INTEGER PRIMARY KEY, mark TEXT NOT NULL DEFAULT '')");
      const out = [];
      for (const f of [() => d.applyExtraction(1, { roles: [], facts: [] }, 1), () => d.foldFacts(1, [2])]) { try { f(); out.push('ran'); } catch (e) { out.push(e.message); } }
      console.log(JSON.stringify(out));`;
    const p = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, DB: join(dir, 'alone.db') }, stdout: 'pipe', stderr: 'pipe' });
    const why = 'The table fact_standing is in the database, but its module was not loaded, so its rows would be lost. Import lib/standing.ts and lib/origins.ts in this process.';
    expect(JSON.parse(p.stdout.toString().trim().split('\n').at(-1)!)).toEqual([why, why]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fold of duplicates: a kept duplicate makes the fact that stays kept', () => {
  const stays = fact(1, 'Built the dispatch console used by 640 schedulers.');
  const dup = fact(1, 'Built the dispatch console, again.');
  expect(setFactMark(dup, 'kept')).toBe('');
  db.transaction(() => { foldFacts(stays, [dup]); db.query('DELETE FROM facts WHERE id = ?').run(dup); })();
  expect(factMark(stays)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  // A duplicate kept only by its project counts too.
  const third = fact(1, 'Wrote the console runbook.'), dup2 = fact(1, 'Wrote the runbook.');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, dup2);
  expect(setProjectMark(console1, 'kept')).toBe('');
  db.transaction(() => { foldFacts(third, [dup2]); db.query('DELETE FROM facts WHERE id = ?').run(dup2); })();
  expect(factMark(third).mark).toBe('kept');
  // Nothing kept, nothing changes.
  const plain = fact(1, 'Ran planning.'), dup3 = fact(1, 'Ran the planning call.');
  foldFacts(plain, [dup3]);
  expect(factMark(plain).mark).toBe('documents');
});

// ---------- The same words as a kept fact, wherever they stand ----------

const sourceNamed = (title: string) => (db.query("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', ?, 'x', 'done', 4) RETURNING id").get(title) as { id: number }).id;
const ofSource = (s: number) => (db.query('SELECT id FROM facts WHERE source_id = ? ORDER BY id').all(s) as { id: number }[]).map((f) => f.id);
const why = () => toolMarks().map((m) => [m.factId, m.reason, m.refId, m.refName]);

test('a confirmed copy of a kept fact\'s words lets the reading through, and that copy is kept', () => {
  applyExtraction(source, reading([{ text: 'Named the private client.' }, { text: 'Other.' }]), 10);
  const kept = idOf('Named the private client.');
  expect(setFactMark(kept, 'kept')).toBe('');
  // The owner types the same words in another role: a confirmed fact, kept at once as a copy.
  const typed = fact(1, 'Named the private client.');
  db.query("UPDATE facts SET status = 'confirmed' WHERE id = ?").run(typed);
  expect(factMark(typed)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(mayUse(typed, 'resume')).toBe(false);
  // Read again with the same words: the reading skips them (a confirmed fact has them), and is not held.
  expect(applyExtraction(source, reading([{ text: 'Named the private client.' }, { text: 'Other.' }]), 20)).toBe(1);
  expect((db.query('SELECT id FROM facts WHERE text = ?').all('Named the private client.') as { id: number }[]).map((f) => f.id)).toEqual([typed]);
  expect(mayUse(typed, 'resume')).toBe(false);
  expect(why()).toEqual([[typed, 'same-words-as-kept', kept, 'Named the private client.']]);
  // And again: never held, however often it is read.
  expect(applyExtraction(source, reading([{ text: 'Named the private client.' }, { text: 'Other.' }]), 30)).toBe(1);
});

test('a confirmed copy that was not yet kept is kept by the reading that drops the kept fact', () => {
  applyExtraction(source, reading([{ text: 'Named the private client.' }]), 10);
  const kept = idOf('Named the private client.');
  const typed = fact(1, 'Named the private client.');
  db.query("UPDATE facts SET status = 'confirmed' WHERE id = ?").run(typed);
  // Kept only through its project, marked straight in the table so no copy is kept yet (as on a database whose project
  // was kept before copies were): the reading must still keep the confirmed copy.
  db.query('UPDATE facts SET role_id = 1, project_id = ? WHERE id = ?').run(console1, kept);
  db.query("INSERT INTO project_standing (project_id, mark) VALUES (?, 'kept')").run(console1);
  expect(factMark(typed).mark).toBe('documents');
  expect(applyExtraction(source, reading([{ text: 'Named the private client.' }]), 20)).toBe(0);
  expect(factMark(typed)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(why()).toEqual([[typed, 'same-words-as-kept', kept, 'Named the private client.']]);
});

test('a wording the owner deleted lets the reading through, and the kept fact goes with it', () => {
  const second = sourceNamed('Second');
  applyExtraction(source, reading([{ text: 'Named the private client.' }]), 10);
  applyExtraction(second, reading([{ text: 'Named the private client.' }]), 10);
  const [kept] = ofSource(source), [copy] = ofSource(second);
  expect(setFactMark(kept, 'kept')).toBe('');
  deleteFact(copy, 11);
  expect(applyExtraction(source, reading([{ text: 'Named the private client.' }]), 20)).toBe(0);
  expect(db.query('SELECT count(*) AS n FROM facts WHERE text = ?').get('Named the private client.')).toEqual({ n: 0 });
});

test('the owner keeps a fact: its copies in other sources are kept; clearing the mark clears them, in both directions', () => {
  const second = sourceNamed('Second');
  applyExtraction(source, reading([{ text: 'Named the private client.' }]), 10);
  applyExtraction(second, reading([{ text: 'named the  private client.' }]), 10);
  const [kept] = ofSource(source), [copy] = ofSource(second);
  expect(setFactMark(kept, 'kept')).toBe('');
  expect([mayUse(kept, 'resume'), mayUse(copy, 'resume')]).toEqual([false, false]);
  expect(why()).toEqual([[copy, 'same-words-as-kept', kept, 'Named the private client.']]);
  // The owner clears their mark: the copy is cleared in the same call.
  expect(setFactMark(kept, '')).toBe('');
  expect([mayUse(kept, 'resume'), mayUse(copy, 'resume')]).toEqual([true, true]);
  expect(toolMarks()).toEqual([]);
  // Marked again, then the copies undone as a group while the owner's mark stays.
  expect(setFactMark(kept, 'kept')).toBe('');
  expect(clearToolMarks('same-words-as-kept', kept)).toBe(1);
  expect([mayUse(kept, 'resume'), mayUse(copy, 'resume')]).toEqual([false, true]);
  // Another mark from the owner (documents) also ends the copies.
  expect(setFactMark(kept, 'kept')).toBe('');
  expect(setFactMark(kept, 'documents')).toBe('');
  expect(mayUse(copy, 'resume')).toBe(true);
});

test('when the first kept fact is cleared, its copies stay kept for another kept fact with the same words', () => {
  const second = sourceNamed('Second'), third = sourceNamed('Third');
  for (const s of [source, second, third]) applyExtraction(s, reading([{ text: 'Named the private client.', roleKey: 'role:1' }]), 10);
  const [a] = ofSource(source), [b] = ofSource(second), [c] = ofSource(third);
  expect(setFactMark(a, 'kept')).toBe('');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, b);
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(setFactMark(a, '')).toBe('');
  // b is kept through its project, so a and c are now its copies.
  expect(why()).toEqual([[a, 'same-words-as-kept', b, 'Named the private client.'], [c, 'same-words-as-kept', b, 'Named the private client.']]);
  // The project's mark cleared: nothing is kept any more.
  expect(setProjectMark(console1, '')).toBe('');
  expect([a, b, c].map((id) => mayUse(id, 'resume'))).toEqual([true, true, true]);
});

test('a fact added by hand, or reworded, to a kept fact\'s words is kept; a kept fact reworded keeps the words it now says', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const added = addFact({ text: '  speaks CONVERSATIONAL\ticelandic. ', roleId: 1 }, 20);
  expect(added.ok).toBe(true);
  const addedId = (added as { id: number }).id;
  expect(factMark(addedId)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(patchFact(dayToDay, { text: 'Speaks conversational Icelandic.' }, 21).ok).toBe(true);
  expect(factMark(dayToDay)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(why().map((w) => [w[0], w[1], w[2]])).toEqual([[dayToDay, 'same-words-as-kept', general], [addedId, 'same-words-as-kept', general]].sort((x, y) => (x[0] as number) - (y[0] as number)));
  // A kept fact reworded to another fact's words makes that fact kept.
  expect(patchFact(general, { text: 'Cut quoting latency.' }, 22).ok).toBe(true);
  expect(factMark(inUndated)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  // Words the trigger cannot compare (non-ASCII case) are still caught where the owner's mark spreads.
  const accented = fact(2, 'ÉTÉ report.'), lower = fact(2, 'été report.');
  expect(factMark(lower).mark).toBe('documents');
  expect(setFactMark(accented, 'kept')).toBe('');
  expect(factMark(lower).mark).toBe('kept');
});

// ---------- Round four: cost, refusals, kept projects, and copies that lose their reason ----------

test('the trigger key never calls two texts the same that norm() calls different', () => {
  const pairs: [string, string][] = [
    ['a\vb', 'a b'], ['a\fb', 'a b'], ['a b', 'a b'], ['A  B', 'a b'], ['x' + ' '.repeat(70) + 'y', 'x y'], ['x' + ' '.repeat(200) + 'y', 'x y'],
    ['Résumé', 'résumé'], ['ÉCOLE', 'école'], [' a b ', 'a b'], ['a\tb', 'a b'], ['a\r\nb', 'a b'], ['Ran the desk.', 'Ran the desk'], ['İ', 'i̇'],
  ];
  for (const [x, y] of pairs) {
    const keyEq = triggerKey(x) === triggerKey(y);
    if (keyEq) expect([x, y, norm(x) === norm(y)]).toEqual([x, y, true]);
  }
  // The cases it is meant to catch, it catches.
  expect(['A  B', 'a\tb', ' a b ', 'a\r\nb'].map((x) => triggerKey(x) === triggerKey('a b'))).toEqual([true, true, true, true]);
});

test('the same-words triggers are cheap: 3,000 new facts with nothing kept, and with some kept', () => {
  // Before kept_words, each insert read every fact: 3,000 took about 17 s. Now each is one indexed lookup.
  for (const kept of [0, 5]) {
    reset();
    role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering' });
    for (let i = 0; i < kept; i++) expect(setFactMark(fact(1, `Kept fact ${i}.`), 'kept')).toBe('');
    const t0 = performance.now();
    db.transaction(() => { for (let i = 0; i < 3000; i++) db.query("INSERT INTO facts (role_id, kind, text, created_at) VALUES (1, 'other', ?, 1)").run(`Bulk fact number ${i} with some words.`); })();
    expect(performance.now() - t0).toBeLessThan(2000);
    // A copy among them is still found.
    const copy = fact(1, 'kept FACT 0.');
    expect(factMark(copy).mark).toBe(kept > 0 ? 'kept' : 'documents');
  }
});

test('words kept back on one fact cannot be made usable on another', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const copy = fact(2, 'speaks conversational  icelandic.');
  const refused = `These words are kept back on ${factRef(general)}. Clear that mark first.`;
  expect(setFactMark(copy, 'public')).toBe(refused);
  expect(setFactMark(copy, 'documents')).toBe(refused);
  // Even with the tool's mark cleared by hand: the words are still kept back on the other fact.
  expect(clearToolMark(copy)).toBe(true);
  expect(setFactMark(copy, 'public')).toBe(refused);
  expect(offered()).toEqual([]);
  // A project's facts marked public at once leave it out.
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(undated, copy);
  expect(markFactsPublic(undated)).toEqual({ ok: true, marked: [inUndated] });
  // Once the owner clears the other mark, it can be made public.
  expect(setFactMark(general, '')).toBe('');
  expect(setFactMark(copy, 'public')).toBe('');
});

test('a kept project\'s own source can be read again with its facts reworded; a fact that would be usable still holds it', () => {
  applyExtraction(source, reading([{ text: 'Tide one.' }, { text: 'Tide two.' }]), 10);
  expect(setProjectMark(tidepool, 'kept')).toBe('');
  // Everything the reading makes lands in the kept side project: it goes through, and all of it is kept.
  expect(applyExtraction(source, reading([{ text: 'Tide one, again.' }, { text: 'Tide two.' }]), 20)).toBe(2);
  for (const t of ['Tide one, again.', 'Tide two.']) expect(factMark(idOf(t)).mark).toBe('kept');
  // A reworded fact plus a new fact outside the kept project: held.
  expect(() => applyExtraction(source, reading([{ text: 'Tide one, a third time.' }, { text: 'Tide two.' }, { text: 'Ran the harbour office.', roleKey: 'role:1' }]), 30)).toThrow(HeldReading);
  // Mixed: a fact kept by the owner's own mark, outside the project, with no successor, and the reading makes a usable
  // fact: held.
  applyExtraction(source, reading([{ text: 'Tide one, again.' }, { text: 'Tide two.' }, { text: 'Named the harbour master.', roleKey: 'role:1' }]), 40);
  expect(setFactMark(idOf('Named the harbour master.'), 'kept')).toBe('');
  expect(() => applyExtraction(source, reading([{ text: 'Tide one, again.' }, { text: 'Tide two.' }, { text: 'Named Rowan as harbour master.', roleKey: 'role:1' }]), 50)).toThrow(HeldReading);
  // The same, with every fact landing in the kept project: through.
  expect(applyExtraction(source, reading([{ text: 'Tide one, again.' }, { text: 'Tide two.' }, { text: 'Named Rowan as harbour master.' }]), 60)).toBe(3);
  expect(factMark(idOf('Named Rowan as harbour master.')).mark).toBe('kept');
});

test('a copy reworded away from the kept words is no longer a copy; reworded within them, it stays', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const copy = fact(2, 'Speaks conversational Icelandic.');
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('SPEAKS conversational  Icelandic.', copy);
  expect(why()).toEqual([[copy, 'same-words-as-kept', general, 'Speaks conversational Icelandic.']]);
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('Speaks some Icelandic.', copy);
  expect(factMark(copy)).toEqual({ mark: 'documents', from: 'default', by: '' });
  expect(toolMarks()).toEqual([]);
  // A fact with the words of a former copy is not a copy of it.
  expect(factMark(fact(2, 'Speaks some Icelandic.')).mark).toBe('documents');
});

test('a kept fact reworded takes its copies along only where they still say its words', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const same = fact(2, 'Speaks conversational Icelandic.'), later = fact(2, 'Speaks fluent Icelandic.');
  expect(factMark(later).mark).toBe('documents');
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('Speaks fluent Icelandic.', general);
  // The old copy no longer matches and is cleared; the fact that says the new words is now a copy.
  expect(factMark(same).mark).toBe('documents');
  expect(why()).toEqual([[later, 'same-words-as-kept', general, 'Speaks fluent Icelandic.']]);
  // A copy that still matches another kept fact moves to it instead of clearing.
  const other = fact(2, 'Speaks fluent Icelandic.');
  const second = fact(1, 'Speaks fluent Icelandic.');
  expect(setFactMark(second, 'kept')).toBe('');
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('Reads Old Norse.', general);
  expect(why().filter((w) => w[0] === other || w[0] === later)).toEqual([[later, 'same-words-as-kept', second, 'Speaks fluent Icelandic.'], [other, 'same-words-as-kept', second, 'Speaks fluent Icelandic.']].sort((x, y) => (x[0] as number) - (y[0] as number)));
});

test('a kept fact the owner deletes leaves its copies kept, listed with its words', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const copy = fact(2, 'Speaks conversational Icelandic.');
  deleteFact(general, 30);
  expect(factMark(copy)).toEqual({ mark: 'kept', from: 'fact', by: 'tool' });
  expect(why()).toEqual([[copy, 'same-words-as-kept', general, 'Speaks conversational Icelandic.']]);
  // Reworded within the same words, it stays; reworded away, it is cleared.
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('speaks conversational icelandic.', copy);
  expect(factMark(copy).mark).toBe('kept');
  db.query('UPDATE facts SET text = ? WHERE id = ?').run('Speaks Danish.', copy);
  expect(factMark(copy).mark).toBe('documents');
  // Or the owner clears the group.
  const again = fact(2, 'Kept words.');
  expect(setFactMark(again, 'kept')).toBe('');
  const c2 = fact(1, 'Kept words.');
  deleteFact(again, 31);
  expect(clearToolMarks('same-words-as-kept', again)).toBe(1);
  expect(factMark(c2).mark).toBe('documents');
});

test('many copies reworded at once: no trigger sets itself off, and the marks come out right', () => {
  expect(setFactMark(general, 'kept')).toBe('');
  const copies = Array.from({ length: 50 }, () => fact(2, 'Speaks conversational Icelandic.'));
  db.run("UPDATE facts SET text = 'Speaks conversational Icelandic. ' WHERE role_id = 2 AND text LIKE 'Speaks%'");
  expect(copies.every((id) => factMark(id).mark === 'kept')).toBe(true);
  db.run("UPDATE facts SET text = 'Speaks Danish.' WHERE role_id = 2 AND text LIKE 'Speaks%'");
  expect(copies.some((id) => factMark(id).mark === 'kept')).toBe(false);
});

// ---------- Deletion and ids ----------

test('a deleted fact takes its month and mark with it, a deleted project its standing, and a new row inherits nothing', () => {
  expect(setFactMark(inProject, 'public')).toBe('');
  expect(setFactMonth(inProject, '2022-09')).toBe('');
  expect(setProjectMark(console1, 'documents')).toBe('');
  expect(placeProject(console1, 2)).toBe('');
  deleteFact(inProject, 10);
  expect(db.query('SELECT count(*) AS n FROM fact_standing WHERE fact_id = ?').get(inProject)).toEqual({ n: 0 });
  db.query('DELETE FROM projects WHERE id = ?').run(console1);
  expect(db.query('SELECT count(*) AS n FROM project_standing WHERE project_id = ?').get(console1)).toEqual({ n: 0 });
  // A row left under an id a new fact then takes is cleared, not inherited.
  const next = (db.query('SELECT max(id) + 1 AS id FROM facts').get() as { id: number }).id;
  db.query("INSERT INTO fact_standing (fact_id, mark, marked_by, approved) VALUES (?, 'public', 'owner', 'x')").run(next);
  const d = fact(1, 'Fourth.');
  expect(d).toBe(next);
  expect(factMark(d)).toEqual({ mark: 'documents', from: 'default', by: '' });
});

// ---------- Dates and state ----------

test('a fact takes its own month, then its project\'s dates, then its role\'s', () => {
  expect(factWhen(inProject)).toEqual({ start: '2022-01', end: '2023-06', from: 'project' });
  // A carried project's dates are on its roles row.
  expect(factWhen(inCarried)).toEqual({ start: '2023-05', end: '2024-02', from: 'project' });
  // A project with no dates gives way to its role.
  expect(factWhen(inUndated)).toEqual({ start: '2016-01', end: '2021-02', from: 'role' });
  expect(factWhen(dayToDay)).toEqual({ start: '2021-03', end: '', from: 'role' });
  expect(factWhen(general)).toEqual({ start: '', end: '', from: 'none' });
  expect(setFactMonth(inProject, '2022-09')).toBe('');
  expect(factWhen(inProject)).toEqual({ start: '2022-09', end: '2022-09', from: 'fact' });
  expect(setFactMonth(inProject, '')).toBe('');
  expect(factWhen(inProject).from).toBe('project');
  expect(setFactMonth(inProject, 'Sept 2022')).toBe('Write the month as YYYY-MM.');
  expect(setFactMonth(inProject, '2022-13')).toBe('Write the month as YYYY-MM.');
  expect(setFactMonth(9999, '2022-01')).toBe('That fact is not in the record.');
});

test('a project\'s last month and state are kept apart from its start and end', () => {
  expect(projectStanding(console1)).toEqual({ projectId: console1, lastWorked: '', state: 'unknown', mark: '', place: null });
  expect(setProjectWork(console1, { lastWorked: '2023-05', state: 'off' })).toBe('');
  expect(setProjectWork(console1, { state: 'ended' })).toBe('');
  expect(projectStanding(console1)).toMatchObject({ lastWorked: '2023-05', state: 'ended' });
  expect(setProjectWork(console1, { lastWorked: '2023' })).toBe('Write the month as YYYY-MM.');
  expect(setProjectWork(console1, { state: 'paused' as 'off' })).toBe('That is not a state of work.');
  expect(setProjectWork(9999, { state: 'off' })).toBe('That project is not in the record.');
  expect(db.query('SELECT start, end FROM projects WHERE id = ?').get(console1)).toEqual({ start: '2022-01', end: '2023-06' });
  expect(projectMark(console1)).toBe('documents');
});

// ---------- Rank ----------

const item = (id: number, o: Partial<RankItem> = {}): RankItem => ({ id, state: 'unknown', lastWorked: '', months: 0, commits: 0, ownerPlace: null, ...o });

test('the order of unplaced projects: state, then recency, then months, then commits, then id', () => {
  // State: running, ended, unknown, off, whatever else they hold.
  expect(rank([item(1, { state: 'off', lastWorked: '2026-10' }), item(2, { state: 'unknown' }), item(3, { state: 'ended' }), item(4, { state: 'running' })])).toEqual([4, 3, 2, 1]);
  // Recency: the latest month first, and a project with no month after every one with a month.
  expect(rank([item(1), item(2, { lastWorked: '2024-01' }), item(3, { lastWorked: '2025-07' })])).toEqual([3, 2, 1]);
  // Recency comes before size: a short project worked lately comes before a long one worked earlier.
  expect(rank([item(1, { lastWorked: '2023-12', months: 60, commits: 900 }), item(2, { lastWorked: '2025-03', months: 2, commits: 4 })])).toEqual([2, 1]);
  // Months worked, then the owner's commits.
  expect(rank([item(1, { months: 3 }), item(2, { months: 12 }), item(3, { months: 3, commits: 40 })])).toEqual([2, 3, 1]);
  // Nothing else to tell them apart: the lower id first.
  expect(rank([item(7), item(3), item(5)])).toEqual([3, 5, 7]);
});

test('a project the owner placed keeps its place, and the rest fill the other places', () => {
  const items = [item(1, { state: 'running' }), item(2, { state: 'ended' }), item(3, { state: 'off', ownerPlace: 1 }), item(4, { ownerPlace: 3 }), item(5, { state: 'running', lastWorked: '2026-01' })];
  expect(rank(items)).toEqual([3, 5, 4, 1, 2]);
  // Two owner places on one slot: the lower id first. A place past the end lands last.
  expect(rank([item(1), item(2, { ownerPlace: 1 }), item(3, { ownerPlace: 1 }), item(4, { ownerPlace: 50 })])).toEqual([2, 3, 1, 4]);
  expect(rank([])).toEqual([]);
});

test('the order does not depend on the order of the input', () => {
  const items = [item(1, { state: 'running', months: 4 }), item(2, { state: 'running', months: 4 }), item(3, { ownerPlace: 2 }), item(4, { lastWorked: '2025-02', commits: 9 }), item(5, { lastWorked: '2025-02', commits: 9 }), item(6, { state: 'off' })];
  const once = rank(items);
  for (let i = 0; i < 20; i++) {
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    expect(rank(shuffled)).toEqual(once);
  }
  expect(once).toEqual([1, 3, 2, 4, 5, 6]);
});

test('months worked count both ends, and an open end counts only while the work runs', () => {
  expect(monthsWorked('2024-01', '2024-03', 'ended', '2026-11')).toBe(3);
  expect(monthsWorked('2024-11', '2025-02', 'ended', '2026-11')).toBe(4);
  expect(monthsWorked('2026-01', '', 'running', '2026-11')).toBe(11);
  expect(monthsWorked('2026-01', '', 'unknown', '2026-11')).toBe(0);
  expect(monthsWorked('', '2024-03', 'ended', '2026-11')).toBe(0);
  expect(monthsWorked('2020', '2020-06', 'ended', '2026-11')).toBe(6);
});

test('the order now: the owner\'s places stay, the tool places the rest, and it always agrees with rank()', () => {
  // The side project runs and has commits in a repository tied to its row; the dispatch console ended.
  expect(setProjectWork(tidepool, { state: 'running' })).toBe('');
  expect(setProjectWork(console1, { state: 'ended' })).toBe('');
  expect(recordRepo('https://git.example/tidepool/tables', { first: '2023-05-02T10:00:00Z', last: '2024-02-20T10:00:00Z', commits: 31 }, { roleId: 10 })).toBe('');
  const items = rankItems('2026-11');
  expect(items.find((i) => i.id === tidepool)).toEqual({ id: tidepool, state: 'running', lastWorked: '2024-02', months: 10, commits: 31, ownerPlace: null });
  expect(items.find((i) => i.id === console1)).toEqual({ id: console1, state: 'ended', lastWorked: '2023-06', months: 18, commits: 0, ownerPlace: null });
  expect(placed('2026-11')).toEqual([{ projectId: tidepool, place: 1, placedBy: 'tool' }, { projectId: console1, place: 2, placedBy: 'tool' }, { projectId: undated, place: 3, placedBy: 'tool' }]);
  // The owner puts the side project third: placed() shows it third at once.
  expect(placeProject(tidepool, 3)).toBe('');
  expect(placed('2026-11')).toEqual([{ projectId: console1, place: 1, placedBy: 'tool' }, { projectId: undated, place: 2, placedBy: 'tool' }, { projectId: tidepool, place: 3, placedBy: 'owner' }]);
  expect(placed('2026-11').map((p) => p.projectId)).toEqual(rank(rankItems('2026-11')));
  // Three owner places on the same slot, and no other project: they come in order of id.
  for (const p of [tidepool, console1, undated]) expect(placeProject(p, 2)).toBe('');
  expect(placed('2026-11')).toEqual([{ projectId: tidepool, place: 1, placedBy: 'owner' }, { projectId: console1, place: 2, placedBy: 'owner' }, { projectId: undated, place: 3, placedBy: 'owner' }]);
  expect(placeProject(undated, 0)).toBe('A place is a whole number from 1.');
  expect(placeProject(9999, 1)).toBe('That project is not in the record.');
  // Taken back, they are the tool's to place again.
  for (const p of [tidepool, console1, undated]) expect(placeProject(p, null)).toBe('');
  expect(placed('2026-11').map((p) => p.placedBy)).toEqual(['tool', 'tool', 'tool']);
});
