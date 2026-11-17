// The ingestion worker: `bun worker.ts`, beside server.ts on the standing machine. It takes
// queued sources one at a time, has Claude Code read each (lib/ingest.ts), and writes what it
// found into the bank; then it writes the profile from the bank (lib/profile.ts). The API never calls a model, so tests and the app stay fast without it.
// It also keeps the questions that code raises for the person in step with the bank (lib/checks.ts): after each
// source is read, and once when it starts. A LinkedIn export's positions are kept as data when it is read (lib/linkedin.ts).
import { writeFileSync } from 'node:fs';
import { applyExtraction, associate, bankSignature, db, type SourceRow } from './lib/db.ts';
import { discover } from './lib/discover.ts';
import { hub } from './lib/github.ts';
import { read } from './lib/ingest.ts';
import { assess, compose, FactsError, fetchPosting, finishWritten, keepEarlier, publish, reflagOpen, storeComposed, type Analysis, type JobRow } from './lib/jobs.ts';
import { syncQuestions } from './lib/checks.ts';
import { positions, storePositions } from './lib/linkedin.ts';
import { lastAnswerAt, rewriteDue } from './lib/raised.ts';
import { inData } from './lib/paths.ts';
import { write } from './lib/profile.ts';
import { prune, reply, type TalkRow } from './lib/talk.ts';
import { draft } from './lib/outreach.ts';
// The log of slow work follows the status columns by itself; the worker adds only where a piece has got to.
import { setStage } from './lib/activity.ts';

// A source left running by a worker that died goes back in the queue.
db.run("UPDATE sources SET status = 'queued', note = '' WHERE status = 'running'");
db.run("UPDATE profile SET status = 'queued', note = '' WHERE status = 'running'");
db.run("UPDATE jobs SET status = 'queued', note = '' WHERE status = 'running'");
db.run("UPDATE discovery SET status = 'queued' WHERE status = 'running'");

// A LinkedIn export read before its positions were kept as data: they are taken from its stored text now, with no model.
if (positions().length === 0) {
  const old = db.query("SELECT id, body FROM sources WHERE kind = 'text' AND status = 'done' AND body LIKE '%## Positions.csv%' ORDER BY id DESC LIMIT 1").get() as { id: number; body: string } | null;
  if (old) console.log(`kept ${storePositions(old.body, old.id, Date.now())} LinkedIn positions from an export read earlier`);
}
// The questions code raises (job dates, LinkedIn differences, skills) and the flags that read them, as the bank now stands.
try { syncQuestions(Date.now()); reflagOpen(); } catch (e) { console.log(`questions could not be checked: ${(e as Error).message}`); }

// The watchlist is checked when asked, and by itself once a day.
const DAY = 86_400_000;
async function checkWatchlist() {
  db.run("UPDATE discovery SET status = 'running', note = '' WHERE id = 1");
  console.log('checking the watchlist');
  try {
    const said = await discover(Date.now());
    db.query("UPDATE discovery SET status = 'idle', note = ?, checked_at = ? WHERE id = 1").run(said, Date.now());
    console.log(`  ${said}`);
  } catch (e) {
    db.query("UPDATE discovery SET status = 'failed', note = ?, checked_at = ? WHERE id = 1").run((e as Error).message, Date.now());
    console.log(`  failed: ${(e as Error).message}`);
  }
}
// The profile is also kept as a file beside the database, for use outside the app.
const PROFILE_FILE = inData('profile.md');

// Sources come first; the profile is written once none is waiting, from everything they added.
async function writeProfile() {
  db.run("UPDATE profile SET status = 'running', note = '' WHERE id = 1");
  console.log('writing the profile');
  const signature = bankSignature();
  try {
    const p = await write();
    db.query("UPDATE profile SET status = 'done', note = '', body = ?, gaps = ?, signature = ?, updated_at = ? WHERE id = 1").run(p.markdown.trim(), p.gaps.map((g) => g.trim()).filter(Boolean).join('\n'), signature, Date.now());
    writeFileSync(PROFILE_FILE, `${p.markdown.trim()}\n`);
    console.log(`  written (${PROFILE_FILE})`);
    await prune(inData('inbox')).then((n) => console.log(`  ${n} open questions already answered, closed`)).catch(() => {});
  } catch (e) {
    db.query("UPDATE profile SET status = 'failed', note = ? WHERE id = 1").run((e as Error).message);
    console.log(`  failed: ${(e as Error).message}`);
  }
}
// A job is read once the bank is settled: no source waiting and no profile being written. This first
// reading is quick: it says what the posting asks and how the person fits. The resume is written after,
// by the loop below, so the fit shows without waiting for it.
async function readJob(job: JobRow) {
  db.query("UPDATE jobs SET status = 'running', note = '' WHERE id = ?").run(job.id);
  console.log(`reading job ${job.id}`);
  try {
    if (job.posting.trim() === '') setStage('read-posting', job.id, 'Fetching the posting');
    const posting = job.posting.trim() !== '' ? job.posting : await fetchPosting(job.url);
    setStage('read-posting', job.id, 'Weighing it against your record');
    if (job.posting.trim() === '') db.query('UPDATE jobs SET posting = ? WHERE id = ?').run(posting, job.id);
    const a = await assess(posting, job.resume);
    if (!db.query('SELECT id FROM jobs WHERE id = ?').get(job.id)) return;
    // What the last resume's review, skim and flags said stays with that resume until a new one is written.
    const before = job.analysis ? (JSON.parse(job.analysis) as Analysis) : undefined;
    db.query("UPDATE jobs SET status = 'done', note = '', title = ?, company = ?, place = ?, fit = ?, analysis = ?, terms_raw = ?, resume_status = 'queued', resume_note = '', updated_at = ? WHERE id = ?")
      .run(a.title || 'Untitled role', a.company, a.place, a.fit, JSON.stringify({ ...a.analysis, changes: before?.changes ?? [], review: before?.review, map: before?.map, skim: before?.skim, questions: before?.questions, written: before?.written, flags: before?.flags }), JSON.stringify(a.terms), Date.now(), job.id);
    console.log(`  fit ${a.fit}; resume queued`);
  } catch (e) {
    db.query("UPDATE jobs SET status = 'failed', note = ? WHERE id = ?").run((e as Error).message, job.id);
    console.log(`  failed: ${(e as Error).message}`);
  }
}

// Resumes are written beside the readings, one at a time: each takes minutes, with its council review.
db.run("UPDATE jobs SET resume_status = 'queued' WHERE resume_status = 'running'");
void (async () => {
  for (;;) {
    const job = db.query("SELECT * FROM jobs WHERE resume_status = 'queued' AND status = 'done' ORDER BY fit DESC, id LIMIT 1").get() as (JobRow & { terms_raw: string }) | null;
    if (!job) { await Bun.sleep(1500); continue; }
    db.query("UPDATE jobs SET resume_status = 'running', resume_note = '' WHERE id = ?").run(job.id);
    console.log(`writing the resume for job ${job.id}`);
    const wroteFrom = bankSignature();
    try {
      // The writer is given the posting map from the first reading: its requirements, each with its strongest evidence.
      const c = await compose(job.posting, job.pages, JSON.parse(job.terms_raw || '[]') as string[], job.analysis ? (JSON.parse(job.analysis) as Analysis).requirements ?? [] : [], (words) => setStage('write-resume', job.id, words));
      // Gone, or asked for again while this one was being written (a re-read, another length): this one is dropped and the next is written.
      if (!storeComposed(job.id, c, wroteFrom, Date.now())) continue;
      // The text is kept now; the resume is done only once its PDF is printed and checked. If that fails, the text
      // stays, and the resume says it failed and why (the PDF is printed again when it is next asked for).
      setStage('write-resume', job.id, 'Printing the PDF and checking it');
      try { await publish(job.id); } catch (e) {
        db.query("UPDATE jobs SET resume_status = 'failed', resume_note = ? WHERE id = ? AND resume_status = 'running'").run(`The resume was written, but its PDF couldn’t be made. ${(e as Error).message}`, job.id);
        console.log(`  resume for job ${job.id} written; printing failed: ${(e as Error).message}`);
        continue;
      }
      finishWritten(job.id);
      console.log(`  resume for job ${job.id} written and printed`);
      await prune(inData('inbox')).then((n) => console.log(`  ${n} open questions already answered, closed`)).catch(() => {});
    } catch (e) {
      // The signature is kept on a failure too, so a resume that cannot be written is not asked for again on every pass.
      db.query("UPDATE jobs SET resume_status = 'failed', resume_note = ?, bank_sig = ? WHERE id = ?").run((e as Error).message, wroteFrom, job.id);
      // A version that named a job the bank does not have is never stored. The earlier resume stands, and says why.
      if (e instanceof FactsError) keepEarlier(job.id, (e as Error).message);
      console.log(`  resume failed: ${(e as Error).message}`);
    }
  }
})();
// A resume follows the bank. Once the bank has been still for a few minutes after a change (so a run of edits
// or answers is taken together), every unsent job's resume that was written from an older bank is written again.
// A resume the person edited by hand is left alone: the app says it is out of date and they choose.
const QUIET = Number(process.env.EGG_RESUME_QUIET_MS ?? 180_000);
if (process.env.EGG_AUTO_RESUME !== 'off') void (async () => {
  let seen = bankSignature(), since = Date.now() - QUIET;
  for (;;) {
    await Bun.sleep(5000);
    const sig = bankSignature();
    if (sig !== seen) { seen = sig; since = Date.now(); continue; }
    // Also held back for a while after the person's last answer to a raised question, so one sitting of answers
    // (each can change a role) causes one rewrite, not one for each answer (ANSWER_HOLD_MS in lib/raised.ts).
    if (!rewriteDue(Date.now(), since, QUIET, lastAnswerAt())) continue;
    const n = db.query("UPDATE jobs SET resume_status = 'queued', resume_note = '' WHERE outcome = '' AND status = 'done' AND resume != '' AND edited = 0 AND resume_status IN ('', 'done', 'failed') AND bank_sig != ?").run(sig).changes;
    if (n) console.log(`the bank changed: ${n} unsent resume${n === 1 ? '' : 's'} queued to be written again`);
  }
})();
// Talk is answered beside everything else, so a reply never waits behind a long reading.
db.run("UPDATE talk SET status = 'queued', note = '' WHERE status = 'running'");
void (async () => {
  for (;;) {
    const turn = db.query("SELECT * FROM talk WHERE status = 'queued' ORDER BY id LIMIT 1").get() as TalkRow | null;
    if (!turn) { await Bun.sleep(700); continue; }
    db.query("UPDATE talk SET status = 'running' WHERE id = ?").run(turn.id);
    try { await reply(turn, inData('inbox')); console.log(`talk: replied to message ${turn.id}`); }
    catch (e) { db.query("UPDATE talk SET status = 'failed', note = ? WHERE id = ?").run((e as Error).message, turn.id); console.log(`talk: failed: ${(e as Error).message}`); }
  }
})();
// Outreach drafts are written beside everything else too: they are short, and asked for while the person is looking at the job.
db.run("UPDATE jobs SET outreach_status = 'queued' WHERE outreach_status = 'running'");
void (async () => {
  for (;;) {
    const job = db.query("SELECT * FROM jobs WHERE outreach_status = 'queued' ORDER BY id LIMIT 1").get() as (JobRow & { contact: string }) | null;
    if (!job) { await Bun.sleep(900); continue; }
    db.query("UPDATE jobs SET outreach_status = 'running', outreach_note = '' WHERE id = ?").run(job.id);
    try {
      const doors = await draft(job, inData('inbox'));
      db.query("UPDATE jobs SET outreach = ?, outreach_status = 'done' WHERE id = ?").run(JSON.stringify(doors), job.id);
      console.log(`outreach: ${doors.length} drafts for job ${job.id}`);
    } catch (e) { db.query("UPDATE jobs SET outreach_status = 'failed', outreach_note = ? WHERE id = ?").run((e as Error).message, job.id); console.log(`outreach: failed: ${(e as Error).message}`); }
  }
})();
console.log('worker.ts: waiting for sources');

for (;;) {
  const source = db.query("SELECT * FROM sources WHERE status = 'queued' ORDER BY id LIMIT 1").get() as SourceRow | null;
  if (!source) {
    const job = db.query("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as JobRow | null;
    if ((db.query('SELECT status FROM profile WHERE id = 1').get() as { status: string }).status === 'queued') await writeProfile();
    else if (job) await readJob(job);
    else {
      const d = db.query('SELECT status, checked_at FROM discovery WHERE id = 1').get() as { status: string; checked_at: number };
      const due = d.status === 'queued' || (d.status !== 'running' && Date.now() - d.checked_at > DAY && (db.query('SELECT count(*) AS n FROM companies').get() as { n: number }).n > 0);
      if (due) await checkWatchlist();
      else await Bun.sleep(2000);
    }
    continue;
  }
  db.query("UPDATE sources SET status = 'running', note = '' WHERE id = ?").run(source.id);
  console.log(`reading ${source.kind} "${source.title}"`);
  try {
    const found = await read(source);
    // Deleted while it was being read: keep nothing.
    if (!db.query('SELECT id FROM sources WHERE id = ?').get(source.id)) continue;
    const n = applyExtraction(source.id, found, Date.now());
    // A LinkedIn export's positions are also kept as rows, to compare with the roles (a text with none changes nothing).
    if (source.kind === 'text') { const kept = storePositions(source.body, source.id, Date.now()); if (kept) console.log(`  ${kept} LinkedIn positions kept`); }
    // File a repository's project under the employer whose organisation or name it carries.
    if (source.kind === 'github') associate((await hub()).login);
    db.query("UPDATE sources SET status = 'done', note = ? WHERE id = ?").run(n === 0 ? 'Nothing new was found in it.' : '', source.id);
    // New facts make the profile out of date: write it again once the queue is empty.
    if (n > 0) db.run("UPDATE profile SET status = 'queued', note = '' WHERE id = 1 AND status != 'running'");
    console.log(`  ${n} facts added`);
    // New roles, dates or skills can raise or settle a question for the person.
    try { syncQuestions(Date.now()); reflagOpen(); } catch (e) { console.log(`  questions could not be checked: ${(e as Error).message}`); }
  } catch (e) {
    db.query("UPDATE sources SET status = 'failed', note = ? WHERE id = ?").run((e as Error).message, source.id);
    console.log(`  failed: ${(e as Error).message}`);
  }
}
