// The Stories screen (DESIGN.md section 12): every project with something to tell, grouped under its job, each with its
// spoken story (lib/spoken.ts), how long it takes to say, and how often the owner practised it; and the questions the
// owner was asked in real interviews, each with the story that answers it.
//
// story_practice: one row each time the owner practised a story: when, and the seconds it took when it was timed (null
// when it was not). It goes with its project. interview_questions: a question the owner was asked, in their words; the
// job it was asked at (null for none); the project that answers it (null for none); no_story 1 when the owner said no
// story is needed. A question is part of the job tracker's history: it stays when its job or its project goes, and
// loses only that link. Additive only: new tables and their triggers, made when this file is imported.
import { db } from './db.ts';
import { CARL } from './derive.ts';
import { tree } from './tree.ts';
import { hasStory, heldByOwner, spokenSeconds, timeLine, timeWords, wordCount } from './spoken.ts';

db.run(`CREATE TABLE IF NOT EXISTS story_practice (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, at INTEGER NOT NULL, seconds INTEGER)`);
db.run('CREATE INDEX IF NOT EXISTS story_practice_project ON story_practice (project_id)');
db.run(`CREATE TABLE IF NOT EXISTS interview_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, job_id INTEGER, added_at INTEGER NOT NULL,
  project_id INTEGER, no_story INTEGER NOT NULL DEFAULT 0)`);
// Made again at every start, under the write lock, so a change to a body reaches an existing database.
db.transaction(() => {
  db.run('DROP TRIGGER IF EXISTS stories_project_gone');
  db.run(`CREATE TRIGGER stories_project_gone AFTER DELETE ON projects BEGIN
    DELETE FROM story_practice WHERE project_id = OLD.id;
    UPDATE interview_questions SET project_id = NULL WHERE project_id = OLD.id; END`);
  db.run('DROP TRIGGER IF EXISTS stories_job_gone');
  db.run(`CREATE TRIGGER stories_job_gone AFTER DELETE ON jobs BEGIN
    UPDATE interview_questions SET job_id = NULL WHERE job_id = OLD.id; END`);
}).immediate();

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dayOf = (t: number) => DAY.format(t);
const GONE = 'That project is no longer in your record.';
// The longest question kept, in characters, and the longest practice timed, in seconds.
export const MAX_QUESTION = 500, MAX_SECONDS = 7200;

// ---------- Practice ----------

type PracticeRow = { id: number; project_id: number; at: number; seconds: number | null };
const practicesOf = (project: number) => db.query('SELECT * FROM story_practice WHERE project_id = ? ORDER BY at DESC, id DESC').all(project) as PracticeRow[];

// One practice, now, with the seconds it took when it was timed (null when not). A time past two hours is no reading
// aloud: the practice is kept with no time. '' when kept, else why not.
export function addPractice(project: number, seconds: unknown, now: number): string {
  if (!db.query('SELECT 1 FROM projects WHERE id = ?').get(project)) return GONE;
  if (seconds !== null && seconds !== undefined && !(Number.isInteger(seconds) && (seconds as number) > 0)) return 'Send the time it took as a whole number of seconds.';
  const timed = typeof seconds === 'number' && seconds <= MAX_SECONDS ? seconds : null;
  db.query('INSERT INTO story_practice (project_id, at, seconds) VALUES (?, ?, ?)').run(project, now, timed);
  return '';
}
export const deletePractice = (id: number) => db.query('DELETE FROM story_practice WHERE id = ?').run(id).changes > 0;

// How often a story was practised, in one line: "Practised 3 times, last on 19 Nov 2026", or "Not practised yet".
export function practiceLine(rows: { at: number }[]): string {
  if (rows.length === 0) return 'Not practised yet';
  const last = dayOf(Math.max(...rows.map((r) => r.at)));
  return rows.length === 1 ? `Practised once, on ${last}` : `Practised ${rows.length} times, last on ${last}`;
}

// ---------- Questions from real interviews ----------

type QuestionRow = { id: number; text: string; job_id: number | null; added_at: number; project_id: number | null; no_story: number };
type JobName = { id: number; title: string; company: string };
// A job's or role's name: its title at its company, or the one it has ('' for a job not read yet).
const jobName = (j: { title: string; company: string }) => (j.title && j.company ? `${j.title} at ${j.company}` : j.title || j.company);
const sameWords = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A question the owner was asked, at a job or none. Returns its id, or why not.
export function addQuestion(text: unknown, job: unknown, now: number): { ok: true; id: number } | { ok: false; error: string; status: number } {
  const words = typeof text === 'string' ? text.trim() : '';
  if (words === '') return { ok: false, error: 'Write the question you were asked.', status: 400 };
  if (words.length > MAX_QUESTION) return { ok: false, error: `Keep the question under ${MAX_QUESTION} characters.`, status: 400 };
  const jobId = job === null || job === undefined || job === '' ? null : Number(job);
  if (jobId !== null && !db.query('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) return { ok: false, error: 'That job is no longer in your tracker.', status: 404 };
  const before = db.query('SELECT text FROM interview_questions WHERE job_id IS ?').all(jobId) as { text: string }[];
  if (before.some((q) => sameWords(q.text) === sameWords(words))) return { ok: false, error: jobId === null ? 'That question is in your list already.' : 'That question is in this job’s list already.', status: 409 };
  const made = db.query('INSERT INTO interview_questions (text, job_id, added_at) VALUES (?, ?, ?) RETURNING id').get(words, jobId, now) as { id: number };
  return { ok: true, id: made.id };
}

// The story that answers a question (null for none), or the owner's word that no story is needed (true) or that one is
// after all (false). Only a project with something told can answer one. Choosing a story takes back "No story needed".
// '' when done, else why not.
export function settleQuestion(id: number, change: { project?: unknown; noStory?: unknown }): string {
  if (!db.query('SELECT 1 FROM interview_questions WHERE id = ?').get(id)) return 'That question is no longer in your list.';
  if ('project' in change) {
    const v = change.project;
    if (!(v === null || v === '' || (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\d+$/.test(v)))) return 'Say which story answers it, by its number.';
    const project = v === null || v === '' ? null : Number(v);
    const p = project === null ? null : (projectsNow().find((x) => x.id === project) ?? 'gone');
    if (p === 'gone') return GONE;
    if (p !== null && !told(p)) return 'That piece of work has nothing told yet. Tell it first, then choose it.';
    db.query('UPDATE interview_questions SET project_id = ?, no_story = CASE WHEN ? IS NULL THEN no_story ELSE 0 END WHERE id = ?').run(project, project, id);
    return '';
  }
  if (typeof change.noStory === 'boolean') {
    db.query('UPDATE interview_questions SET no_story = ? WHERE id = ?').run(change.noStory ? 1 : 0, id);
    return '';
  }
  return 'Say which story answers it, or that none is needed.';
}
export const deleteQuestion = (id: number) => db.query('DELETE FROM interview_questions WHERE id = ?').run(id).changes > 0;

// A question as the lists show it: the job it came from ("" for none), the day it was added, and the story that answers
// it ("" for none).
export type Question = { id: string; text: string; jobId: string; job: string; added: string; projectId: string; story: string; noStory: boolean };
function questionsWhere(where: string, ...args: number[]): Question[] {
  const rows = db.query(`SELECT * FROM interview_questions WHERE ${where} ORDER BY added_at DESC, id DESC`).all(...args) as QuestionRow[];
  const jobs = new Map((db.query('SELECT id, title, company FROM jobs').all() as JobName[]).map((j) => [j.id, jobName(j)]));
  const titles = new Map(placed().projects.map((p) => [p.id, p.title]));
  return rows.map((q) => ({ id: String(q.id), text: q.text, jobId: q.job_id === null ? '' : String(q.job_id), job: q.job_id === null ? '' : jobs.get(q.job_id) ?? '',
    added: dayOf(q.added_at), projectId: q.project_id === null ? '' : String(q.project_id), story: q.project_id === null ? '' : titles.get(String(q.project_id)) ?? '', noStory: q.no_story === 1 }));
}

// The questions no story answers yet and the owner did not say need none, newest first: each is one Home item.
export function unanswered(): { id: number; text: string; jobId: string; job: string }[] {
  return questionsWhere('project_id IS NULL AND no_story = 0').map((q) => ({ id: Number(q.id), text: q.text, jobId: q.jobId, job: q.job }));
}

// ---------- The lists ----------

type ProjectLean = { id: number; role_id: number | null; via_role: number | null; title: string; start: string; end: string; lives: string; context: string; action: string; result: string; learning: string; spoken: string; spoken_wrote: string; spoken_status: string; spoken_note: string };
const projectsNow = () => db.query('SELECT * FROM projects ORDER BY id').all() as ProjectLean[];
const rolesNow = () => db.query('SELECT * FROM roles').all() as Parameters<typeof tree>[0];
const told = (p: { spoken: string; context: string; action: string; result: string; learning: string }) => p.spoken.trim() !== '' || CARL.some((k) => p[k].trim() !== '');

// Every project as the tree places it, with the name of its job ("" for a side project or one not placed).
function placed() {
  const t = tree(rolesNow(), projectsNow(), []);
  const roles = new Map(t.roles.map((r) => [r.id, r]));
  return { roles: t.roles, projects: t.projects.map((p) => ({ ...p, job: roles.has(p.roleId) ? jobName(roles.get(p.roleId)!) : '' })) };
}
// The choices of a question's select: each story with its job in brackets.
export function storyChoices(): { id: string; label: string }[] {
  const rows = new Map(projectsNow().map((p) => [String(p.id), p]));
  return placed().projects.filter((p) => told(rows.get(p.id)!)).map((p) => ({ id: p.id, label: `${p.title} (${p.job || (p.place === 'side' ? 'side project' : 'not placed yet')})` }));
}

export type StoryRow = { id: string; ref: string; title: string; line: string };
export type StoryGroup = { key: string; name: string; stories: StoryRow[] };
// GET /stories: the projects with a spoken story or a part, under their jobs (newest first), then the side projects and
// the projects not placed yet; how many have nothing to tell yet; every question, newest first; and the select's choices.
export function storiesList() {
  const rows = new Map(projectsNow().map((p) => [String(p.id), p]));
  const practice = new Map<string, { at: number }[]>();
  for (const r of db.query('SELECT project_id, at FROM story_practice').all() as { project_id: number; at: number }[]) practice.set(String(r.project_id), [...(practice.get(String(r.project_id)) ?? []), r]);
  const t = placed(), listed = t.projects.filter((p) => told(rows.get(p.id)!));
  const row = (p: (typeof listed)[number]): StoryRow => {
    const spoken = rows.get(p.id)!.spoken;
    return { id: p.id, ref: p.ref, title: p.title, line: `${wordCount(spoken) === 0 ? 'No spoken story yet' : timeWords(spokenSeconds(spoken))} · ${practiceLine(practice.get(p.id) ?? [])}` };
  };
  const groups: StoryGroup[] = [
    ...t.roles.map((r) => ({ key: `role:${r.id}`, name: jobName(r), stories: listed.filter((p) => p.roleId === r.id).map(row) })),
    { key: 'side', name: 'Side projects', stories: listed.filter((p) => p.place === 'side').map(row) },
    { key: 'unplaced', name: 'Not placed yet', stories: listed.filter((p) => p.place === 'unplaced').map(row) },
  ].filter((g) => g.stories.length > 0);
  return { groups, untold: t.projects.length - listed.length, questions: questionsWhere('1'), choices: storyChoices() };
}

// GET /stories/:id: one story, made for reading aloud. null when the project is gone.
export function storyView(project: number) {
  const p = projectsNow().find((x) => x.id === project);
  if (!p) return null;
  const at = placed().projects.find((x) => x.id === String(project));
  const practices = practicesOf(project), timed = practices.find((r) => r.seconds !== null);
  const time = timeLine(p.spoken, timed?.seconds ?? null);
  return {
    id: String(p.id), ref: at?.ref ?? '', title: at?.title ?? p.title,
    job: at?.job || (at?.place === 'side' ? 'A side project' : 'Not placed in a job yet'),
    spoken: p.spoken, held: heldByOwner(p), status: p.spoken_status, note: p.spoken_note, canWrite: hasStory(project),
    timeLine: wordCount(p.spoken) === 0 ? '' : time.line, over: wordCount(p.spoken) > 0 && time.over,
    practiceLine: practiceLine(practices),
    practices: practices.map((r) => ({ id: String(r.id), on: dayOf(r.at), timed: r.seconds === null ? '' : timeWords(r.seconds) })),
    parts: Object.fromEntries(CARL.map((k) => [k, p[k]])) as Record<(typeof CARL)[number], string>,
    questions: questionsWhere('project_id = ?', project).map((q) => ({ id: q.id, text: q.text, job: q.job })),
  };
}

// GET /jobs/:id/questions: the questions asked at one job, and the select's choices.
export const jobQuestions = (job: number) => ({ questions: questionsWhere('job_id = ?', job), choices: storyChoices() });
