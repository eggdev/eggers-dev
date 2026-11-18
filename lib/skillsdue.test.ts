// `bun test lib`: the Skills lines of unsent resumes, written again once after a sitting of marks (lib/jobs.ts,
// skillsChanged and refreshDueSkills). A mark or a review on a reviewed list only records that the lines are due; the
// worker writes and prints them once no mark has been saved for SKILLS_QUIET_MS. No model is asked; an edited resume is
// left alone; a resume being written is not touched until it is done. The clock is made up. Everything is invented.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, seed } from './scratch.ts';
import { finishWritten, refreshDueSkills, refreshOneSkillsLine, rewriteSkillsLine, skillsChanged, skillsDue, skillsLineOf, SKILLS_QUIET_MS, type JobRow } from './jobs.ts';
import { markFromList } from './skillsview.ts';
import { syncSkills } from './skills.ts';

const T = Date.UTC(2026, 2, 3, 12);
const RESUME = '# Avery Lindqvist\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console.\n\n## Skills\n\nGo, TypeScript, PostgreSQL, Kafka';
const job = (edited = 0, status = 'done') => (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, resume_status, created_at, edited, outcome) VALUES ('A posting about Go.', 'Engineer', 'Nimbus Yard', 'done', '{}', ?, ?, 1, ?, '') RETURNING id")
  .get(RESUME, status, edited) as { id: number }).id;
const resumeOf = (id: number) => (db.query('SELECT resume FROM jobs WHERE id = ?').get(id) as { resume: string }).resume;
const skillsLine = (id: number) => resumeOf(id).split('## Skills')[1]?.trim() ?? '';
// The worker's printing, counted: no browser.
let printed: number[] = [];
const print = async (id: number) => { printed.push(id); };
// The review, then a mark: each recorded as the routes record them.
const mark = (marks: { name: string; mark: string }[], review: boolean, now: number) => { expect(markFromList(marks, review, now).refused).toBeUndefined(); skillsChanged(now); };

beforeEach(() => { seed(); syncSkills(T); printed = []; });

test('the first review only makes the lines due; they are written once, after two minutes with no mark', async () => {
  const a = job(), b = job();
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  expect(skillsDue()).toMatchObject({ due: true });
  expect(skillsLine(a)).toBe('Go, TypeScript, PostgreSQL, Kafka');
  // Nothing is written before two minutes of quiet.
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS - 1, print)).toEqual([]);
  expect(printed).toEqual([]);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, print)).toEqual([a, b]);
  expect([skillsLine(a), skillsLine(b), printed]).toEqual(['Go', 'Go', [a, b]]);
  expect(skillsDue()).toMatchObject({ due: false });
  // Done once: a later pass writes nothing.
  expect(await refreshDueSkills(T + 10 * SKILLS_QUIET_MS, print)).toEqual([]);
});

test('twenty marks in a sitting give one rewrite and one print of each unsent resume; an edited resume is left alone', async () => {
  const a = job(), b = job(), edited = job(1);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  const names = ['TypeScript', 'PostgreSQL', 'Kafka'];
  for (let i = 0; i < 20; i++) mark([{ name: names[i % 3], mark: i % 2 === 0 ? 'confident' : 'not-confident' }], false, T + 1000 * (i + 1));
  const last = T + 20_000;
  // Each mark restarts the quiet: two minutes after the first is not enough.
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, print)).toEqual([]);
  expect(await refreshDueSkills(last + SKILLS_QUIET_MS, print)).toEqual([a, b]);
  expect(printed).toEqual([a, b]);
  expect(resumeOf(edited)).toBe(RESUME);
});

test('a resume being written when the marks are saved is not touched; the lines stay due and it is done after it is written', async () => {
  const a = job(), writing = job(0, 'running');
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, print)).toEqual([a]);
  expect(resumeOf(writing)).toBe(RESUME);
  expect(skillsDue()).toMatchObject({ due: true });
  finishWritten(writing);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS + 5000, print)).toEqual([writing]);
  expect(skillsDue()).toMatchObject({ due: false });
});

test('marks before the first review make nothing due; a mark that changes nothing makes nothing due', async () => {
  job();
  mark([{ name: 'Go', mark: 'confident' }], false, T);
  expect(skillsDue()).toMatchObject({ due: false });
  mark([{ name: 'TypeScript', mark: 'confident' }], true, T + 1);
  expect(await refreshDueSkills(T + 1 + SKILLS_QUIET_MS, print)).toHaveLength(1);
  expect(markFromList([{ name: 'Go', mark: 'confident' }], false, T + 2)).toMatchObject({ marked: 0 });
  expect(skillsDue()).toMatchObject({ due: false });
});

// The due state is in the database: a worker that starts after the marks (a restart) still writes the lines.
const dir = mkdtempSync(join(tmpdir(), 'egg-skills-due-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
test('a restart keeps the due state: a new process writes the lines', async () => {
  const file = join(dir, 'egg.db'), lib = import.meta.dir;
  const run = (code: string) => { const p = Bun.spawnSync(['bun', '-e', code], { env: { ...process.env, DB: file, NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' }); if (p.exitCode !== 0) throw new Error(p.stderr.toString().slice(-800)); return p.stdout.toString().trim().split('\n').pop()!; };
  run(`const { db } = await import('${lib}/db.ts'); const { syncSkills } = await import('${lib}/skills.ts'); const { markFromList } = await import('${lib}/skillsview.ts'); const { skillsChanged } = await import('${lib}/jobs.ts');
    db.run("INSERT INTO roles (id, company, title, start) VALUES (1, 'Harborlight Systems', 'Director of Engineering', '2021-03')");
    db.run("INSERT INTO facts (role_id, kind, text, skills, created_at) VALUES (1, 'accomplishment', 'Built the console.', 'Go, Kafka', 1)");
    db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, resume_status, created_at, edited, outcome) VALUES ('Go.', 'Engineer', 'Nimbus Yard', 'done', '{}', ?, 'done', 1, 0, '')").run(${JSON.stringify(RESUME)});
    syncSkills(${T}); markFromList([{ name: 'Go', mark: 'confident' }], true, ${T}); skillsChanged(${T}); console.log('marked');`);
  const out = run(`const { db } = await import('${lib}/db.ts'); const { refreshDueSkills, skillsDue } = await import('${lib}/jobs.ts');
    const before = skillsDue().due; const done = await refreshDueSkills(${T + SKILLS_QUIET_MS}, async () => {});
    console.log(JSON.stringify({ before, done, after: skillsDue().due, line: db.query('SELECT resume FROM jobs').get().resume.split('## Skills')[1].trim() }));`);
  expect(JSON.parse(out)).toEqual({ before: true, done: [1], after: false, line: 'Go' });
}, 60_000);

// ---------- Review of the Skills screen ----------
const pdfOf = (id: number) => (db.query('SELECT pdf FROM jobs WHERE id = ?').get(id) as { pdf: string }).pdf;
// Printing as publish does it, in short: the PDF path is set.
const printFile = async (id: number) => { printed.push(id); db.query('UPDATE jobs SET pdf = ? WHERE id = ?').run(`/tmp/invented-${id}.pdf`, id); };

test('a written Skills line always drops the old PDF; a pass cut short before printing ends with a fresh PDF', async () => {
  const a = job();
  db.query("UPDATE jobs SET pdf = '/tmp/old.pdf' WHERE id = ?").run(a);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  // The worker stops while printing: the text is new and the old PDF is gone, never older than the text.
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, async () => { throw new Error('The browser went away.'); })).toEqual([a]);
  expect([skillsLine(a), pdfOf(a), skillsDue().due]).toEqual(['Go', '', true]);
  // The next pass prints it, though its text no longer changes.
  // A failed try waits a minute before the next.
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS + 5000, printFile)).toEqual([]);
  expect(printed).toEqual([]);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS + 60_000, printFile)).toEqual([]);
  expect([printed, pdfOf(a), skillsDue().due]).toEqual([[a], `/tmp/invented-${a}.pdf`, false]);
});

test('one job that cannot be done does not stop the others, and after three tries it is left out with a note', async () => {
  const good = job(), bad = job();
  db.query("UPDATE jobs SET analysis = '{not json' WHERE id = ?").run(bad);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, printFile)).toEqual([good]);
  expect([skillsLine(good), pdfOf(good), skillsDue().due]).toEqual(['Go', `/tmp/invented-${good}.pdf`, true]);
  // Tried again after a minute, then after two more.
  await refreshDueSkills(T + SKILLS_QUIET_MS + 60_000, printFile);
  expect(skillsDue().due).toBe(true);
  await refreshDueSkills(T + SKILLS_QUIET_MS + 180_000, printFile);
  // Three tries: left out, with a note on that job; the lines are no longer due, and later passes do nothing.
  expect(skillsDue().due).toBe(false);
  expect(skillsLineOf(bad)).toBe('This resume’s Skills line could not be written again from your skills list. Write the resume again to bring it up to date.');
  expect(skillsLineOf(good)).toBe('');
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS + 400_000, printFile)).toEqual([]);
  expect(printed).toEqual([good]);
});

test('an edit saved between the read and the write is never overwritten: the job is tried again on the next pass', () => {
  const a = job();
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  const read = db.query('SELECT * FROM jobs WHERE id = ?').get(a) as JobRow & { edited: number };
  db.query("UPDATE jobs SET resume = 'The owner’s own words.', edited = 1 WHERE id = ?").run(a);
  expect(rewriteSkillsLine(read)).toBe(false);
  expect(resumeOf(a)).toBe('The owner’s own words.');
});

test('a resume stuck waiting behind a reading that failed does not keep the lines due; one being written does, and the line says why after 5 minutes', async () => {
  const a = job();
  db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, resume_status, created_at, edited, outcome) VALUES ('Go.', 'E', 'N', 'failed', '{}', ?, 'queued', 1, 0, '')").run(RESUME);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, printFile)).toEqual([a]);
  expect(skillsDue().due).toBe(false);
  const writing = job(0, 'running');
  mark([{ name: 'TypeScript', mark: 'confident' }], false, T + 1000);
  expect(skillsDue(T + 2000).line).toBe('Resumes that are not sent get the new list in about 2 minutes.');
  await refreshDueSkills(T + 1000 + SKILLS_QUIET_MS, printFile);
  expect(skillsDue(T + 1000 + 6 * 60_000)).toMatchObject({ due: true, line: 'Resumes that are not sent get the new list once the resume being written now is done.' });
  finishWritten(writing);
  await refreshDueSkills(T + 1000 + 7 * 60_000, printFile);
  expect(skillsDue().due).toBe(false);
});

test('one job on its own: its Skills line now, with no model, when its PDF is asked for or it is sent', async () => {
  const a = job(), edited = job(1);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  expect(skillsLineOf(a)).toBe('Your skills list changed. This resume gets the new list in about 2 minutes, or when you open its PDF.');
  expect(await refreshOneSkillsLine(a, printFile)).toBe(true);
  expect([skillsLine(a), printed, skillsLineOf(a)]).toEqual(['Go', [a], '']);
  expect(await refreshOneSkillsLine(edited, printFile)).toBe(false);
  expect(resumeOf(edited)).toBe(RESUME);
});

test('a PDF that keeps failing to print is tried at most once while another resume is being written, and the later passes write nothing', async () => {
  const a = job();
  job(0, 'running');
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  let tries = 0;
  const failing = async () => { tries++; throw new Error('The browser went away.'); };
  const changes = () => (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  expect(await refreshDueSkills(T + SKILLS_QUIET_MS, failing)).toEqual([a]);
  const after = changes();
  for (let i = 1; i <= 5; i++) await refreshDueSkills(T + SKILLS_QUIET_MS + i * 5000, failing);
  expect(tries).toBe(1);
  expect(changes() - after).toBe(0);
  expect([pdfOf(a), skillsDue().due]).toEqual(['', true]);
});

test('a job deleted takes its row of tries with it', async () => {
  const bad = job();
  db.query("UPDATE jobs SET analysis = '{not json' WHERE id = ?").run(bad);
  mark([{ name: 'Go', mark: 'confident' }], true, T);
  await refreshDueSkills(T + SKILLS_QUIET_MS, printFile);
  expect(db.query('SELECT count(*) AS n FROM skills_due_jobs WHERE job_id = ?').get(bad)).toEqual({ n: 1 });
  db.query('DELETE FROM jobs WHERE id = ?').run(bad);
  expect(db.query('SELECT count(*) AS n FROM skills_due_jobs WHERE job_id = ?').get(bad)).toEqual({ n: 0 });
});
