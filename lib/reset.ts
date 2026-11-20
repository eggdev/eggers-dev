// Starting a new record (POST /record/reset): the career record and everything written from it are deleted, so the
// owner can tell it again from nothing. It cannot be undone here; the backups in the bucket are the only way back.
//
// Deleted: the record (sources, roles, projects with their spoken stories, facts, Talk, the telling sittings, the
// practices of each story, suggested projects, the deleted wordings) and everything derived from it (the profile, questions and answers, LinkedIn positions, marks and origins,
// the skills list, repository activity, verdicts on "How you work"), the work log's rows about them, and the data
// folder's files that came from them (profile.md, unslop.md, inbox/, repos/, the egg.db.before-* copies).
// Kept: the owner's details and direction, the job tracker and the watchlist. The questions asked in real interviews
// are the job tracker's history: they stay, and lose the story that answered them. A job already sent keeps everything:
// its resume, links, PDF and versions. A job not yet sent keeps its posting and tracking, and loses what was written
// from the old record (clearJobs below). Reference numbers are never reused: id_floor and SQLite's sequences stay, so
// a kept sent resume that cites a fact by number never comes to cite a new fact.
//
// The database part is one transaction that takes the write lock first. Files go only after it commits; a file that
// cannot be deleted is said in the result, never a failure.
//
// It also writes a mark (record_resets) that the backup keeper reads (cloud/lib/sqlite.ts, statsOf): it lets the one
// backup taken after it through the keeper's shrink guard, which would otherwise refuse a backup with no roles or facts
// (cloud/lib/manifest.ts, shrinkCheck).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { db } from './db.ts';
import { DATA_DIR, DB_FILE, inData } from './paths.ts';
import { REPOS } from './github.ts';
import { removePrints } from './pdf.ts';
import { clearUnsent } from './versions.ts';

// One row each time the owner starts a new record. Never deleted: the keeper reads the latest time.
db.run('CREATE TABLE IF NOT EXISTS record_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL)');

// The words the owner types to confirm.
export const CONFIRM = 'start a new record';

// What a job not yet sent says once its reading is gone: it waits until the owner reads it again.
export const NOT_READ = 'Your record was started again, so this posting has not been read against it. Read it again once your record has facts.';

// The work the worker takes, each as the rows it will take (the same conditions as cloud/lib/sqlite.ts, WORK), named
// for the refusal.
const WORK: { what: string; table: string; where: string }[] = [
  { what: 'a source being read', table: 'sources', where: "status IN ('queued', 'running')" },
  { what: 'the profile being written', table: 'profile', where: "status IN ('queued', 'running')" },
  { what: 'a posting being read', table: 'jobs', where: "status IN ('queued', 'running')" },
  { what: 'a resume being written', table: 'jobs', where: "(resume_status = 'queued' AND status = 'done') OR resume_status = 'running'" },
  { what: 'messages being drafted', table: 'jobs', where: "outreach_status IN ('queued', 'running')" },
  { what: 'a reply in Talk', table: 'talk', where: "status IN ('queued', 'running')" },
  { what: 'the watchlist being checked', table: 'discovery', where: "status IN ('queued', 'running')" },
  { what: 'projects being suggested', table: 'roles', where: "propose_status IN ('queued', 'running')" },
  { what: 'a story being written', table: 'projects', where: "derive_status IN ('queued', 'running')" },
  { what: 'a spoken story being written', table: 'projects', where: "spoken_status IN ('queued', 'running')" },
];

// The record and what is derived from it, in the order they are emptied. Projects go before facts, and the marks and
// the tables triggers write into go last: a trigger on a deleted project or fact (lib/standing.ts writes kept marks
// onto facts before a kept project goes) can only write into a table that is emptied after it.
export const RECORD = ['project_proposals', 'projects', 'story_practice', 'facts', 'roles', 'capture_turns', 'capture_sittings', 'profile_answers', 'talk', 'sources', 'deleted_facts'];
export const DERIVED = ['answered', 'raised_questions', 'linkedin_positions', 'fact_origins', 'fact_standing', 'project_standing', 'kept_words',
  'skills', 'repo_activity', 'derived_lines', 'queue_snoozes', 'skills_due_jobs', 'stand_outs'];
// Single-row tables put back to their start state, and tables of which only some rows go (the work log).
export const RESET_IN_PLACE = ['profile', 'skills_review', 'skills_due', 'activity_bank', 'activity'];
// The work log's kinds about the record, and the ones about a job's resume and messages.
const RECORD_KINDS = ['read-source', 'write-profile', 'write-reply', 'propose-projects', 'derive-story', 'write-spoken'];
const RESUME_KINDS = ['write-resume', 'draft-messages'];

export type Reset = {
  deleted: { roles: number; projects: number; facts: number; sources: number; answers: number; unsentResumes: number };
  kept: { jobs: number; sentResumes: number };
  at: number;
  // Files in the data folder that could not be deleted, by their path inside it.
  notDeleted: string[];
};
export type ResetResult = { ok: true; reset: Reset } | { ok: false; status: number; error: string };

const has = (table: string) => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;
const count = (table: string, where = '1') => (has(table) ? (db.query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n : 0);
// Whether any row of a table is in hand; a table or column that is not there is no work.
const inHand = (table: string, where: string) => { try { return count(table, where) > 0; } catch { return false; } };

// The work waiting or running, in words; empty when none.
export function workInHand(): string[] {
  return WORK.filter((w) => inHand(w.table, w.where)).map((w) => w.what);
}

// What a reset would delete and keep, counted now.
function counts(): Pick<Reset, 'deleted' | 'kept'> {
  return {
    deleted: {
      roles: count('roles'), projects: count('projects'), facts: count('facts'), sources: count('sources'),
      // The owner's answers: in the telling sittings, to questions code raised, and to questions a model asked.
      answers: count('capture_turns', "who = 'owner'") + count('raised_questions', 'answered_at > 0') + count('answered'),
      unsentResumes: count('jobs', "outcome = '' AND resume != ''"),
    },
    kept: { jobs: count('jobs'), sentResumes: count('jobs', "outcome != '' AND resume != ''") },
  };
}

// A job not yet sent: its posting, where it came from, its title and company, when it was posted and its pay, the
// owner's contact and outcome note and its length stay. Its reading, fit, resume, links, check, PDF, signature and
// drafted messages go (clearUnsent takes the resume, its links and versions). It does not go back in the reading
// queue, where the worker would read it at once against an empty record and fail: it waits, as a reading that did not
// happen, with a line that says why, until the owner reads it again.
function clearJobs(now: number): number[] {
  const ids = (db.query("SELECT id FROM jobs WHERE outcome = '' ORDER BY id").all() as { id: number }[]).map((j) => j.id);
  clearUnsent();
  db.query(`UPDATE jobs SET status = 'failed', note = ?, fit = -1, analysis = '', terms_raw = '[]', resume_status = '', resume_note = '', bank_sig = '',
    outreach = '', outreach_status = '', outreach_note = '', ats = '', pdf = '', updated_at = ? WHERE outcome = ''`).run(NOT_READ, now);
  // The watchlist's postings keep what was found, and lose their quick scores: a model wrote them from the old profile.
  // Unscored (-1), they wait to be scored against the next profile; the worker asks no model while there is none
  // (lib/discover.ts, triage).
  if (has('leads')) db.run("UPDATE leads SET score = -1, reason = ''");
  return ids;
}

// Every entry of a folder, the folder kept; a name inside it that cannot go is noted under `label`. A symbolic link is
// removed itself; what it points at is never touched.
function emptyFolder(dir: string, label: string, notDeleted: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    try { rmSync(join(dir, entry), { recursive: true, force: true }); } catch { notDeleted.push(`${label}/${entry}`); }
  }
}

// The files that came from the record. Run after the database part commits.
function deleteFiles(unsent: number[]): string[] {
  const notDeleted: string[] = [];
  const gone = (name: string) => { try { rmSync(inData(name), { force: true }); } catch { notDeleted.push(name); } };
  gone('profile.md');
  gone('unslop.md');
  emptyFolder(inData('inbox'), 'inbox', notDeleted);
  // The cloned repositories, where lib/github.ts keeps them (EGG_REPOS, else repos/ in the data folder).
  emptyFolder(REPOS, REPOS === inData('repos') ? 'repos' : REPOS, notDeleted);
  // The app's own copies of the database from before a tool changed it (tools/unslop.ts, council.ts, refresh.ts).
  const before = `${basename(DB_FILE)}.before-`;
  if (existsSync(DATA_DIR)) for (const name of readdirSync(DATA_DIR).filter((n) => n.startsWith(before))) gone(name);
  // The printed resumes of jobs not yet sent. A sent job's PDF is never touched.
  for (const id of unsent) {
    try { removePrints(id, ''); } catch { notDeleted.push(`resumes/${id}-…`); }
  }
  return notDeleted;
}

// Starts a new record, when `confirm` is the phrase and no work waits or runs. The mark is `now`, or one more than the
// last mark when that is not less: each mark is greater than every one before it, whatever the clock says, so the
// keeper lets the backup after each new record through once (cloud/lib/manifest.ts, shrinkCheck).
export function resetRecord(confirm: unknown, now: number): ResetResult {
  if (confirm !== CONFIRM) return { ok: false, status: 400, error: `Type “${CONFIRM}” to confirm. Nothing was deleted.` };
  let unsent: number[] = [];
  let at = now;
  let done: Pick<Reset, 'deleted' | 'kept'>;
  try {
    done = db.transaction(() => {
      // Checked under the write lock: no work can be asked for between this check and the deletes.
      const busy = workInHand();
      if (busy.length > 0) throw new Refused(`Work is still waiting or running: ${busy.join(', ')}. Wait for it to finish, then try again. Nothing was deleted.`);
      const c = counts();
      unsent = clearJobs(now);
      for (const t of RECORD) if (has(t)) db.run(`DELETE FROM ${t}`);
      for (const t of DERIVED) if (has(t)) db.run(`DELETE FROM ${t}`);
      if (has('interview_questions')) db.run('UPDATE interview_questions SET project_id = NULL');
      if (has('profile')) db.run("UPDATE profile SET body = '', gaps = '', status = 'none', note = '', signature = '', updated_at = 0 WHERE id = 1");
      if (has('skills_review')) db.run('UPDATE skills_review SET reviewed_at = 0 WHERE id = 1');
      if (has('skills_due')) db.run('UPDATE skills_due SET marked_at = 0, done_at = 0 WHERE id = 1');
      if (has('activity')) {
        const kinds = (ks: string[]) => ks.map((k) => `'${k}'`).join(', ');
        db.run(`DELETE FROM activity WHERE kind IN (${kinds(RECORD_KINDS)})`);
        if (unsent.length) db.run(`DELETE FROM activity WHERE kind IN (${kinds(RESUME_KINDS)}) AND subject IN (${unsent.join(', ')})`);
      }
      if (has('activity_bank')) db.run("UPDATE activity_bank SET sig = '', since = 0 WHERE id = 1");
      at = Math.max(now, lastReset() + 1);
      db.query('INSERT INTO record_resets (at) VALUES (?)').run(at);
      return c;
    }).immediate();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: 409, error: e.message };
    throw e;
  }
  return { ok: true, reset: { ...done, at, notDeleted: deleteFiles(unsent) } };
}

class Refused extends Error {}

// Whether a request to start a new record may be taken. The server answers any origin for its other routes; this one
// deletes the record, so a page on another site open in the owner's browser must not be able to send it. It needs a
// JSON body, which a form on another site cannot send without the browser asking first, and an Origin, when the
// request carries one, with the host name the request was sent to: on a development machine the screens and the
// server share a host name and differ in port. In the studio the Worker refuses a change from any page but its own
// and forwards no Origin (studio/worker/studio.ts), and the container's server is reached only through it. '' when
// it may, else why not.
export function sameSite(headers: Headers, url: string): string {
  if (!/^application\/json\s*(;|$)/i.test(headers.get('content-type') ?? '')) return 'Send the request as JSON. Nothing was deleted.';
  const origin = headers.get('origin');
  if (origin === null) return '';
  let from = '';
  try { from = new URL(origin).hostname; } catch { /* "null" or not an address */ }
  return from !== '' && from === new URL(url).hostname ? '' : 'A new record can be started only from the studio’s own screens. Nothing was deleted.';
}

// When the owner last started a new record, 0 for never.
export const lastReset = () => (db.query('SELECT coalesce(max(at), 0) AS at FROM record_resets').get() as { at: number }).at;
