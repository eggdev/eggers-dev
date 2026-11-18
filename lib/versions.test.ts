// `bun test lib`: the versions of a resume's text and the one path that writes it (lib/versions.ts). A version letter is
// made on every stored change of the text (a writing, one Save of the editor, a Skills-line refresh), never for a Save
// that changes nothing, and never at a start. Everything is invented.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, seed } from './scratch.ts';
import { rewriteSkillsLine, saveOwnerEdit, storeComposed, type Composed, type JobRow } from './jobs.ts';
import { keepSent, keepStanding, letter, setResume, versionsOf } from './versions.ts';
import { markFromList } from './skillsview.ts';
import { syncSkills } from './skills.ts';

const RESUME = '# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console.\n\n## Skills\n\nGo, TypeScript, PostgreSQL, Kafka';
const job = (resume = '', edited = 0, status = 'running') => (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, resume_status, created_at, edited, outcome, bank_sig) VALUES ('A posting about Go.', 'Engineer', 'Nimbus Yard', 'done', '{}', ?, ?, 1, ?, '', 'sig-1') RETURNING id")
  .get(resume, status, edited) as { id: number }).id;
const composed = (resume: string): Composed => ({ resume, links: null, changes: [], terms: { inResume: [], inBankOnly: [], missing: [] }, map: { top: [] }, questions: [], repairs: [] });
const rows = (id: number) => versionsOf(id).map((v) => [v.letter, v.why, v.reason]);
const running = (id: number) => db.query("UPDATE jobs SET resume_status = 'running' WHERE id = ?").run(id);
const dir = mkdtempSync(join(tmpdir(), 'egg-versions-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => seed());

test('letters run A to Z, then AA', () => {
  expect([1, 2, 26, 27, 28, 52, 53].map(letter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
});

test('the first writing is A; writing it again is B, with its reason in words', () => {
  const id = job();
  expect(storeComposed(id, composed(RESUME), 'sig-1', 10)).toBe(true);
  expect(rows(id)).toEqual([['A', 'written', 'Written for this posting.']]);
  running(id);
  expect(storeComposed(id, composed(RESUME.replace('Engineer.', 'Engineer who ships.')), 'sig-2', 20)).toBe(true);
  expect(rows(id)).toEqual([['A', 'written', 'Written for this posting.'], ['B', 'written', 'Written again after your record changed.']]);
  expect(versionsOf(id).map((v) => [v.resume.includes('who ships'), v.made_at > 0])).toEqual([[false, true], [true, true]]);
  // The same text written again changes nothing in the history, but the writing's other columns are still stored.
  running(id);
  db.run(`UPDATE jobs SET edited = 1 WHERE id = ${id}`);
  expect(storeComposed(id, composed(RESUME.replace('Engineer.', 'Engineer who ships.')), 'sig-2', 30)).toBe(true);
  expect(versionsOf(id).length).toBe(2);
  expect(db.query('SELECT edited, updated_at FROM jobs WHERE id = ?').get(id)).toEqual({ edited: 0, updated_at: 30 });
});

test('a resume with no row is A by rule: its first change stores it as A, with no date, then the new text as B', () => {
  const id = job(RESUME, 1, 'done');
  expect(versionsOf(id)).toEqual([]);
  expect(setResume(id, `${RESUME}\n- One more.`, null, 'edited', 'You edited 1 line.', { set: { edited: 1 } })).toBe(true);
  const v = versionsOf(id);
  expect(v.map((x) => [x.letter, x.why, x.reason, x.resume === RESUME, x.made_at === 0])).toEqual([['A', 'edited', 'As it stood before versions were kept.', true, true], ['B', 'edited', 'You edited 1 line.', false, false]]);
});

test('a Save that changes nothing makes no letter, and still marks the resume edited as before', () => {
  const id = job(RESUME, 0, 'done');
  expect(setResume(id, RESUME, null, 'edited', 'You edited 0 lines.', { set: { edited: 1 } })).toBe(true);
  expect(versionsOf(id)).toEqual([]);
  expect(db.query('SELECT edited FROM jobs WHERE id = ?').get(id)).toEqual({ edited: 1 });
});

test('a new length gives its reason: the text as it stood is kept as A before the length changes', () => {
  const id = job(RESUME, 0, 'done');
  keepStanding(id);
  keepStanding(id);
  db.run(`UPDATE jobs SET pages = 1, resume_status = 'running' WHERE id = ${id}`);
  expect(storeComposed(id, composed(RESUME.replace('- Built the dispatch console.\n', '')), 'sig-1', 10)).toBe(true);
  expect(rows(id)).toEqual([['A', 'written', 'As it stood before versions were kept.'], ['B', 'written', 'Written again at one page.']]);
});

test('a Skills-line refresh makes a letter, and keeps its guard: an edited or changed resume is not written', () => {
  syncSkills(1);
  expect(markFromList([{ name: 'Go', mark: 'confident' }], true, 1).refused).toBeUndefined();
  const id = job(RESUME, 0, 'done');
  const row = () => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow;
  expect(rewriteSkillsLine(row())).toBe(true);
  expect(rows(id)).toEqual([['A', 'written', 'As it stood before versions were kept.'], ['B', 'skills', 'The Skills line was written again from your reviewed list.']]);
  expect(db.query('SELECT pdf FROM jobs WHERE id = ?').get(id)).toEqual({ pdf: '' });
  // The guard: a row read before an edit is not written over the edit.
  const other = job(RESUME, 0, 'done'), stale = db.query('SELECT * FROM jobs WHERE id = ?').get(other) as JobRow;
  db.query("UPDATE jobs SET resume = ?, edited = 1 WHERE id = ?").run(`${RESUME}\n`, other);
  expect(rewriteSkillsLine(stale)).toBe(false);
  expect(versionsOf(other)).toEqual([]);
  expect(setResume(other, 'x', null, 'skills', 'r', { guard: { resume: `${RESUME}\n`, edited: 0 } })).toBe(false);
  expect(setResume(other, 'x', null, 'skills', 'r', { guard: { resume: RESUME } })).toBe(false);
});

test('setResume sets only the columns it knows', () => {
  const id = job(RESUME, 0, 'done');
  expect(() => setResume(id, 'x', null, 'written', 'r', { set: { 'resume_status = 1, title': 'x' } })).toThrow();
  expect(setResume(9999, 'x', null, 'written', 'r')).toBe(false);
});

test('deleting a job deletes its versions', () => {
  const id = job(RESUME, 0, 'done');
  setResume(id, `${RESUME}\n- Two.`, null, 'edited', 'You edited 1 line.');
  expect(versionsOf(id).length).toBe(2);
  db.query('DELETE FROM jobs WHERE id = ?').run(id);
  expect(db.query('SELECT count(*) AS n FROM resume_versions WHERE job_id = ?').get(id)).toEqual({ n: 0 });
});

test('two processes writing one job at once never give it two rows with the same letter', async () => {
  const file = join(dir, 'race.db'), lib = import.meta.dir;
  const setup = Bun.spawnSync(['bun', '-e', `const { db } = await import('${lib}/db.ts'); db.query("INSERT INTO jobs (id, posting, resume, created_at) VALUES (1, 'A posting.', 'Text 0', 1)").run();`], { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stderr: 'pipe' });
  expect(setup.exitCode).toBe(0);
  const writer = (who: string) => Bun.spawn(['bun', '-e', `const { setResume } = await import('${lib}/versions.ts'); for (let i = 0; i < 25; i++) setResume(1, '${who} ' + i, null, 'edited', 'You edited 1 line.');`],
    { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  const both = [writer('a'), writer('b')];
  const exits = await Promise.all(both.map(async (p) => [await p.exited, (await new Response(p.stderr).text()).slice(-300)]));
  expect(exits).toEqual([[0, ''], [0, '']]);
  const check = Bun.spawnSync(['bun', '-e', `const { db } = await import('${lib}/db.ts'); console.log(JSON.stringify(db.query('SELECT n FROM resume_versions WHERE job_id = 1 ORDER BY n').all().map((r) => r.n)));`], { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stdout: 'pipe' });
  // 50 writes after A: every letter once, in order; A and the 20 newest are kept (the rest are let go as they were made).
  expect(JSON.parse(check.stdout.toString().trim())).toEqual([1, ...Array.from({ length: 20 }, (_, i) => i + 32)]);
}, 60_000);

// Every write of jobs.resume in a source: the text of an UPDATE of jobs from SET to its WHERE (or the end of the statement),
// quotes and all, that sets `resume =`, or that is built at run time (a template's ${…}, or strings joined with +), so
// no shape of SQL hides a write. And an INSERT into jobs that names the column.
function resumeWrites(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/UPDATE\s+jobs\s+SET\b([\s\S]*?)(?:\bWHERE\b|;|\.(?:run|get|all|values)\(|$)/gi)) {
    if (/\bresume\s*=/.test(m[1]) || /\$\{|['"`]\s*\+|\+\s*['"`]/.test(m[1])) bad.push(m[0].slice(0, 70));
  }
  for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+jobs\s*\(([^)]*)\)/gi)) if (/\bresume\b/.test(m[1])) bad.push(m[0].slice(0, 70));
  return bad;
}

test('the guard sees every shape of SQL that writes jobs.resume, and none that does not', () => {
  const caught = [
    `db.query('UPDATE jobs SET resume = ? WHERE id = ?')`,
    `db.query("UPDATE jobs SET status = 'done', note = '', title = ?, analysis = ?, resume = ?, edited = 0, updated_at = ? WHERE id = ?")`,
    'db.query(`UPDATE jobs SET pdf = \'\', resume = ? WHERE id = ${id}`)',
    'db.query(`UPDATE jobs SET ${cols.join(", ")} WHERE id = ?`)',
    `db.query('UPDATE jobs SET status = ?, ' + 'resume = ? WHERE id = ?')`,
    `db.query('UPDATE jobs SET ' + cols + ' WHERE id = ?')`,
    `db.query("INSERT INTO jobs (posting, resume, created_at) VALUES (?, ?, ?)")`,
  ];
  for (const c of caught) expect([c, resumeWrites(c).length]).toEqual([c, 1]);
  const not = [
    `db.query("UPDATE jobs SET resume_status = 'queued' WHERE id = ?")`,
    `db.query("UPDATE jobs SET pdf = '' WHERE id = ? AND resume = ?")`,
    `db.query('UPDATE jobs SET analysis = ? WHERE id = ?').run(a, id); db.query('SELECT resume = ? FROM jobs')`,
    `db.query("INSERT INTO jobs (posting, created_at) VALUES (?, ?)")`,
  ];
  for (const c of not) expect([c, resumeWrites(c)]).toEqual([c, []]);
});

test('only lib/versions.ts writes jobs.resume', () => {
  const root = join(import.meta.dir, '..');
  // Test support makes its rows on scratch databases; the server and the worker never load it.
  const support = ['lib/scratch.ts', 'lib/oldschema.ts', 'lib/versions.ts'];
  const files = [...readdirSync(join(root, 'lib')).map((f) => `lib/${f}`), 'server.ts', 'worker.ts', ...readdirSync(join(root, 'tools')).map((f) => `tools/${f}`)]
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !support.includes(f));
  const bad = files.flatMap((f) => resumeWrites(readFileSync(join(root, f), 'utf8')).map((w) => `${f}: ${w}`));
  expect(bad).toEqual([]);
  // The check can see a write: lib/versions.ts makes one.
  expect(resumeWrites(readFileSync(join(root, 'lib/versions.ts'), 'utf8')).length).toBeGreaterThan(0);
});

// ---------- How many versions are kept (review finding 7) ----------
test('a job keeps A, the 20 newest and every version that went out; letters are never reused', () => {
  const id = job(RESUME, 0, 'done');
  for (let i = 1; i <= 10; i++) setResume(id, `${RESUME}\n- Line ${i}.`, null, 'edited', 'You edited 1 line.');
  // Marked sent at version K (11): it is kept for good.
  keepSent(id);
  for (let i = 11; i <= 40; i++) setResume(id, `${RESUME}\n- Line ${i}.`, null, 'edited', 'You edited 1 line.');
  const ns = versionsOf(id).map((v) => v.n);
  expect(ns).toEqual([1, 11, ...Array.from({ length: 20 }, (_, i) => 22 + i)]);
  expect(versionsOf(id).filter((v) => v.sent === 1).map((v) => v.letter)).toEqual(['K']);
  // The next letter follows the last, not the count of rows.
  setResume(id, `${RESUME}\n- Line 41.`, null, 'edited', 'You edited 1 line.');
  expect(versionsOf(id).at(-1)!.letter).toBe(letter(42));
  expect(versionsOf(id).length).toBe(22);
});

test('marking a job sent with no version yet writes nothing: its text is A, which is always kept', () => {
  const id = job(RESUME, 0, 'done');
  const before = (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  keepSent(id);
  expect((db.query('SELECT total_changes() AS n').get() as { n: number }).n - before).toBe(0);
});

// ---------- A Save with no change (review finding 8) ----------
test('the owner’s Save that holds the stored text writes nothing, makes no letter and is not printed', () => {
  const id = job(RESUME, 0, 'done');
  const before = (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  expect(saveOwnerEdit(id, RESUME)).toBe('same');
  expect((db.query('SELECT total_changes() AS n').get() as { n: number }).n - before).toBe(0);
  expect(db.query('SELECT edited FROM jobs WHERE id = ?').get(id)).toEqual({ edited: 0 });
  // A real edit is stored, marked edited, with its letter.
  // A Save made over a text that changed since the editor opened it writes nothing either.
  expect(saveOwnerEdit(id, `${RESUME}\n- One more.`, `${RESUME}\n- What the editor opened.`)).toBe('changed');
  expect((db.query('SELECT total_changes() AS n').get() as { n: number }).n - before).toBe(0);
  expect(saveOwnerEdit(id, `${RESUME}\n- One more.`, RESUME)).toBe('saved');
  expect(rows(id)).toEqual([['A', 'written', 'As it stood before versions were kept.'], ['B', 'edited', 'You edited 1 line.']]);
  expect(db.query('SELECT edited FROM jobs WHERE id = ?').get(id)).toEqual({ edited: 1 });
});

// ---------- A table made by an earlier build (review finding A) ----------
test('a versions table in its first shape gains its later columns at start, and stores a version', () => {
  const file = join(dir, 'first-shape.db'), lib = import.meta.dir;
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
  const d = new Database(file);
  // The first shape: no `sent` (and, earlier still, no `links` or `pages`).
  d.run('CREATE TABLE resume_versions (job_id INTEGER NOT NULL, n INTEGER NOT NULL, sig TEXT NOT NULL, resume TEXT NOT NULL, why TEXT NOT NULL, reason TEXT NOT NULL, made_at INTEGER NOT NULL, UNIQUE (job_id, n))');
  d.close();
  const code = `const { db } = await import('${lib}/db.ts'); const { setResume, keepSent, versionsOf } = await import('${lib}/versions.ts');
    const id = db.query("INSERT INTO jobs (posting, resume, created_at) VALUES ('A posting.', 'Text 0', 1) RETURNING id").get().id;
    const ok = setResume(id, 'Text 1', null, 'edited', 'You edited 1 line.'); keepSent(id);
    console.log(JSON.stringify({ ok, rows: versionsOf(id).map((v) => [v.letter, v.resume, v.pages, v.sent, v.links]) }));`;
  const runs = [0, 1].map(() => Bun.spawnSync(['bun', '-e', code], { env: { ...process.env, DB: file, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' }));
  for (const r of runs) expect([r.exitCode, r.stderr.toString().slice(-300)]).toEqual([0, '']);
  expect(JSON.parse(runs[0].stdout.toString().trim().split('\n').pop()!)).toEqual({ ok: true, rows: [['A', 'Text 0', 2, 0, ''], ['B', 'Text 1', 2, 1, '']] });
});

// ---------- Stored text not already in plain form (review, the last round) ----------
test('a stored text with a trailing newline, CRLF or a trailing space is compared in plain form: saved, same, or refused as it should be', () => {
  const plain = RESUME.replace('Engineer.', 'Engineer.');
  for (const [name, stored] of [['trailing newline', `${plain}\n`], ['CRLF', plain.replace(/\n/g, '\r\n')], ['trailing space', plain.replace('Engineer.', 'Engineer.  ')]] as const) {
    const id = job(stored, 0, 'done');
    // The editor opened the text as the route sent it; a Save with no real change is "same", and writes nothing.
    const before = (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
    expect([name, saveOwnerEdit(id, plain, stored)]).toEqual([name, 'same']);
    expect([name, (db.query('SELECT total_changes() AS n').get() as { n: number }).n - before]).toEqual([name, 0]);
    // A real change by another writer meanwhile is still refused.
    expect([name, saveOwnerEdit(id, `${plain}\n- Mine.`, `${stored}\n- Theirs.`)]).toEqual([name, 'changed']);
    // The first real Save made over the text the editor opened is accepted.
    expect([name, saveOwnerEdit(id, `${plain}\n- Mine.`, stored)]).toEqual([name, 'saved']);
    expect([name, (db.query('SELECT resume FROM jobs WHERE id = ?').get(id) as { resume: string }).resume]).toEqual([name, `${plain}\n- Mine.`]);
  }
});
