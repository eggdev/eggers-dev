// Slow work as one log (DESIGN.md rule 8): every piece of work the worker does that takes more than a few seconds is
// a row here, from when it was asked for to when it ended. The screens read it through GET /activity: what waits (and
// its place in line), what runs (its stage, when it started and how long that kind usually takes), what failed, what
// finished, and what finished since the owner last looked (the digest, announced once).
//
// The log follows the status columns the server and the worker already keep (sources.status, jobs.status,
// jobs.resume_status, jobs.outreach_status, profile.status, talk.status, discovery.status, roles.propose_status). It is written by
// triggers on those columns, so every place that asks for work, starts it or ends it (a route, the worker, a reset
// when the worker starts again) is logged the same way, and nothing the worker does changes. Only the stage is
// written by hand, by the worker, through setStage.
//
// A row's state: waiting → running → done | failed. A row whose work was deleted or set aside is 'dropped' and is
// never shown. A failed row stays in view until it is retried (a new row for the same work), dismissed, or the same
// thing is done after all. A thing marked done that never started (a profile saved by hand, a test's result) is a
// row with by_hand = 1: it tells the screens to load again, but it is neither a run nor news for the digest.
// Times are milliseconds since 1970. The usual duration of a kind is the median of its last 10 finished runs, and is
// unknown (-1) until 3 have finished: the screens then say "a few minutes", never an invented number.
import { db } from './db.ts';
import { setResume } from './versions.ts';
import { ANSWER_HOLD_MS, holdSince } from './raised.ts';
// The talk table is made there; the triggers below follow it.
import './talk.ts';

// Each kind of slow work, and the status column it follows. done is the value that column takes when the work ends
// well; failed is always 'failed', and queued and running are always those words.
export const FOLLOW = [
  { kind: 'read-source', table: 'sources', column: 'status', note: 'note', done: 'done' },
  { kind: 'read-posting', table: 'jobs', column: 'status', note: 'note', done: 'done' },
  { kind: 'write-resume', table: 'jobs', column: 'resume_status', note: 'resume_note', done: 'done' },
  { kind: 'draft-messages', table: 'jobs', column: 'outreach_status', note: 'outreach_note', done: 'done' },
  { kind: 'write-profile', table: 'profile', column: 'status', note: 'note', done: 'done' },
  { kind: 'write-reply', table: 'talk', column: 'status', note: 'note', done: 'done' },
  { kind: 'check-watchlist', table: 'discovery', column: 'status', note: 'note', done: 'idle' },
  { kind: 'propose-projects', table: 'roles', column: 'propose_status', note: 'propose_note', done: 'done' },
] as const;
export type Kind = (typeof FOLLOW)[number]['kind'];
const JOB_KINDS = ['read-posting', 'write-resume', 'draft-messages'];
export const LAST_RUNS = 10, FEWEST_RUNS = 3;
// The worker's three loops that take one piece at a time: the main one (sources, then the profile, then postings,
// then the watchlist), the resumes, and each of Talk and the messages on their own.
const MAIN_LINE = ['read-source', 'write-profile', 'read-posting', 'check-watchlist'];

db.run(`CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, subject INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
  asked_at INTEGER NOT NULL, started_at INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT '', ended_at INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'waiting', reason TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', cleared_at INTEGER NOT NULL DEFAULT 0)`);
db.run('CREATE INDEX IF NOT EXISTS activity_work ON activity (kind, subject, state)');
db.run('CREATE INDEX IF NOT EXISTS activity_state ON activity (state, ended_at)');
db.run('CREATE INDEX IF NOT EXISTS activity_ended ON activity (ended_at)');
try { db.run('ALTER TABLE activity ADD COLUMN by_hand INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
// The bank's signature as GET /activity last saw it, and since when: an estimate of when the worker will write unsent
// resumes again by itself (its rule: the bank still for a few minutes, and no answer for longer).
db.run("CREATE TABLE IF NOT EXISTS activity_bank (id INTEGER PRIMARY KEY CHECK (id = 1), sig TEXT NOT NULL DEFAULT '', since INTEGER NOT NULL DEFAULT 0)");
db.run('INSERT OR IGNORE INTO activity_bank (id) VALUES (1)');
// When the owner last looked at Home or Activity: the digest is what finished after it.
db.run('CREATE TABLE IF NOT EXISTS activity_seen (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL DEFAULT 0)');
db.run('INSERT OR IGNORE INTO activity_seen (id) VALUES (1)');

// Now, in milliseconds, as SQLite has it inside a trigger.
const NOW = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)";
// What the work is about, from the row that asked for it: a source's title; a job's title at its company; a role's.
const titleOf = (table: string, row: 'NEW' | 'OLD') => table === 'sources' ? `${row}.title`
  : table === 'roles' ? `CASE WHEN ${row}.title != '' THEN ${row}.title || ' at ' || ${row}.company ELSE ${row}.company END`
  : table === 'jobs' ? `CASE WHEN ${row}.title != '' AND ${row}.company != '' THEN ${row}.title || ' at ' || ${row}.company ELSE ${row}.title || ${row}.company END` : "''";

// The statements that move a kind's row when its column takes a new value, in order.
function moves(f: (typeof FOLLOW)[number]): string {
  const k = `'${f.kind}'`, v = `NEW.${f.column}`, mine = `kind = ${k} AND subject = NEW.id`, open = "state IN ('waiting', 'running')";
  return [
    // Queued again while running: the worker started again and put it back. It waits again.
    `UPDATE activity SET state = 'waiting', started_at = 0, stage = '' WHERE ${mine} AND state = 'running' AND ${v} = 'queued';`,
    // Asked for, or started with nothing waiting: a new row. A failed one before it is put away: it was tried again.
    `UPDATE activity SET cleared_at = ${NOW} WHERE ${mine} AND state = 'failed' AND cleared_at = 0 AND ${v} IN ('queued', 'running') AND NOT EXISTS (SELECT 1 FROM activity WHERE ${mine} AND ${open});`,
    `INSERT INTO activity (kind, subject, title, asked_at, started_at, state) SELECT ${k}, NEW.id, ${titleOf(f.table, 'NEW')}, ${NOW}, CASE WHEN ${v} = 'running' THEN ${NOW} ELSE 0 END, CASE WHEN ${v} = 'running' THEN 'running' ELSE 'waiting' END
      WHERE ${v} IN ('queued', 'running') AND NOT EXISTS (SELECT 1 FROM activity WHERE ${mine} AND ${open});`,
    `UPDATE activity SET state = 'running', started_at = ${NOW}, stage = '' WHERE ${mine} AND state = 'waiting' AND ${v} = 'running';`,
    // Done: a failure before it is put away, since it is done after all. Done with nothing open, or with a row that
    // never started, was done by hand (a save, a test's result): logged as such, and never in the digest.
    `UPDATE activity SET cleared_at = ${NOW} WHERE ${mine} AND state = 'failed' AND cleared_at = 0 AND ${v} = '${f.done}';`,
    `INSERT INTO activity (kind, subject, title, asked_at, ended_at, state, by_hand) SELECT ${k}, NEW.id, ${titleOf(f.table, 'NEW')}, ${NOW}, ${NOW}, 'done', 1
      WHERE ${v} = '${f.done}' AND NOT EXISTS (SELECT 1 FROM activity WHERE ${mine} AND ${open});`,
    `UPDATE activity SET state = 'done', ended_at = ${NOW}, stage = '', result = NEW.${f.note}, title = ${titleOf(f.table, 'NEW')}, by_hand = CASE WHEN started_at = 0 THEN 1 ELSE 0 END WHERE ${mine} AND ${open} AND ${v} = '${f.done}';`,
    `UPDATE activity SET state = 'failed', ended_at = ${NOW}, stage = '', reason = NEW.${f.note}, title = ${titleOf(f.table, 'NEW')} WHERE ${mine} AND ${open} AND ${v} = 'failed';`,
    // Any other value ('', none): the work was set aside.
    `UPDATE activity SET state = 'dropped', ended_at = ${NOW}, stage = '' WHERE ${mine} AND ${open} AND ${v} NOT IN ('queued', 'running', 'failed', '${f.done}');`,
  ].join('\n');
}

// The triggers are made again each time the server or the worker starts, in one transaction, so a change to them
// here takes effect and nothing is written in between without them. They touch only this log. The transaction takes
// the write lock first (immediate): one that read first and then wrote would be refused at once, not made to wait,
// when the other process wrote in between, and the server and the worker start together.
const PRUNE_DAYS = 90;
function follow(now: number) {
  db.transaction(() => {
    for (const t of db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'activity\\_%' ESCAPE '\\'").all() as { name: string }[]) db.run(`DROP TRIGGER IF EXISTS "${t.name}"`);
    for (const f of FOLLOW) {
      const name = `activity_${f.table}_${f.column}`;
      db.run(`CREATE TRIGGER ${name}_update AFTER UPDATE OF ${f.column} ON ${f.table} WHEN NEW.${f.column} IS NOT OLD.${f.column} BEGIN\n${moves(f)}\nEND`);
      if (f.table === 'sources' || f.table === 'jobs' || f.table === 'talk')
        db.run(`CREATE TRIGGER ${name}_insert AFTER INSERT ON ${f.table} WHEN NEW.${f.column} IN ('queued', 'running') BEGIN\n${moves(f)}\nEND`);
    }
    // Work whose subject is deleted is dropped, and a failure about it is put away: there is nothing to try again.
    for (const [table, kinds] of [['sources', ['read-source']], ['jobs', JOB_KINDS], ['talk', ['write-reply']], ['roles', ['propose-projects']]] as const) {
      const of = `kind IN (${kinds.map((k) => `'${k}'`).join(', ')}) AND subject = OLD.id`;
      db.run(`CREATE TRIGGER activity_${table}_delete AFTER DELETE ON ${table} BEGIN
        UPDATE activity SET state = 'dropped', ended_at = ${NOW}, stage = '' WHERE ${of} AND state IN ('waiting', 'running');
        UPDATE activity SET cleared_at = ${NOW} WHERE ${of} AND state = 'failed' AND cleared_at = 0;
      END`);
    }
    // Work already waiting or running when the log began (or while it was not kept) gets its row now.
    for (const f of FOLLOW) {
      db.run(`INSERT INTO activity (kind, subject, title, asked_at, started_at, state)
        SELECT '${f.kind}', t.id, ${titleOf(f.table, 'NEW').replaceAll('NEW.', 't.')}, ${NOW}, CASE WHEN t.${f.column} = 'running' THEN ${NOW} ELSE 0 END, CASE WHEN t.${f.column} = 'running' THEN 'running' ELSE 'waiting' END
        FROM ${f.table} t WHERE t.${f.column} IN ('queued', 'running')
          AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.kind = '${f.kind}' AND a.subject = t.id AND a.state IN ('waiting', 'running'))`);
    }
    prune(now);
  }).immediate();
}
// Rows that ended more than 90 days ago go, except a failure still in view and the last 10 runs of each kind that
// ended well, which its usual duration needs. Returns how many went.
export function prune(now: number): number {
  return db.query(`DELETE FROM activity WHERE ended_at > 0 AND ended_at < ? AND NOT (state = 'failed' AND cleared_at = 0)
    AND id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY ended_at DESC) AS n FROM activity WHERE state = 'done' AND started_at > 0) WHERE n <= ${LAST_RUNS})`)
    .run(now - PRUNE_DAYS * 86_400_000).changes;
}

// The worker says where a piece of running work has got to ("Being reviewed, round 2"). Nothing when it is not running.
export function setStage(kind: Kind, subject: number, stage: string) {
  db.query("UPDATE activity SET stage = ? WHERE kind = ? AND subject = ? AND state = 'running'").run(stage, kind, subject);
}

export const seenAt = () => (db.query('SELECT at FROM activity_seen WHERE id = 1').get() as { at: number }).at;
// The owner has seen the digest up to `at`: the end time of the latest line that was drawn, so a piece that ended
// after the screen last asked is still announced next time. Refused ('' when taken): a time to come, or one older
// than the one kept.
export function markSeen(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return 'Say up to when the digest was seen.';
  if (at > now) return 'That time has not come yet.';
  if (at < seenAt()) return 'A later digest has already been seen.';
  db.query('UPDATE activity_seen SET at = ? WHERE id = 1').run(at);
  return '';
}

type Row = { id: number; kind: Kind; subject: number; title: string; asked_at: number; started_at: number; stage: string; ended_at: number; state: string; reason: string; result: string; cleared_at: number;
  jtitle: string | null; jcompany: string | null; jfit: number | null; jstatus: string | null; stitle: string | null; rid: number | null; last_ended: number | null; seen: number };
// Only a failed row can be retried or dismissed; it is null for any other.
export const failedRow = (id: number) => db.query("SELECT * FROM activity WHERE id = ? AND state = 'failed' AND cleared_at = 0").get(id) as Row | null;
export function dismiss(id: number, now: number): boolean {
  return db.query("UPDATE activity SET cleared_at = ? WHERE id = ? AND state = 'failed' AND cleared_at = 0").run(now, id).changes > 0;
}

// The middle of the numbers (the mean of the two middle ones for an even count).
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
// How long each kind usually takes: the median of its last 10 runs that ended well, once 3 have.
export function usual(): Map<string, number> {
  const runs = db.query(`SELECT kind, ended_at - started_at AS took FROM (SELECT kind, started_at, ended_at, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY ended_at DESC) AS n
    FROM activity WHERE state = 'done' AND started_at > 0) WHERE n <= ${LAST_RUNS}`).all() as { kind: string; took: number }[];
  const by = new Map<string, number[]>();
  for (const r of runs) by.set(r.kind, [...(by.get(r.kind) ?? []), Math.max(0, r.took)]);
  return new Map([...by].filter(([, t]) => t.length >= FEWEST_RUNS).map(([k, t]) => [k, median(t)]));
}

// A job's reference number, as the screens write it: J-023.
export const jobRef = (id: number) => `J-${String(id).padStart(3, '0')}`;
const lower = (s: string) => s.replace(/[.!?]\s*$/, '');
// A line of the digest starts lowercase, as the others do ("no project stood out…").
const firstLower = (s: string) => (s === '' ? s : `${s[0].toLowerCase()}${s.slice(1)}`);

// One row as the screens show it. ahead: how many pieces are ahead of it in its line while it waits, -1 otherwise.
// since: how long ago it was asked for (waiting), started (running) or ended (done, failed). took: how long a finished
// run took, -1 when unknown. usual: its kind's usual duration, -1 when unknown.
export type Item = { id: string; kind: string; subject: string; ref: string; what: string; status: string; ahead: number; stage: string;
  since: number; took: number; usual: number; reason: string; link: string; endedAt: number };
export type Digest = { id: string; line: string; link: string; endedAt: number };
// changes: for each kind, when a row of it last changed (asked, started or ended); lastChanged is the latest of them.
// dueIn: milliseconds until the worker is expected to start work by itself (unsent resumes written again after the
// record changed), when that is within 20 minutes; else 0.
export type Activity = { busy: boolean; lastEnded: number; lastChanged: number; changes: { kind: string; at: number }[]; dueIn: number; items: Item[]; done: Item[]; digest: Digest[] };

// The worker's rule for writing unsent resumes again (worker.ts): the bank still for EGG_RESUME_QUIET_MS, and the last
// answer to a raised question or hand edit to the record at least ANSWER_HOLD_MS old. The daily watchlist check is never reported: an idle tab
// must not wake the studio for it.
const QUIET = Number(process.env.EGG_RESUME_QUIET_MS ?? 180_000), DUE_WITHIN = 20 * 60_000, OVERDUE = 60_000;
export function dueIn(now: number, signature: () => string): number {
  if (process.env.EGG_AUTO_RESUME === 'off') return 0;
  const sigs = (db.query("SELECT DISTINCT bank_sig AS sig FROM jobs WHERE outcome = '' AND status = 'done' AND resume != '' AND edited = 0 AND resume_status IN ('', 'done', 'failed')").all() as { sig: string }[]).map((r) => r.sig);
  if (sigs.length === 0) return 0;
  const sig = signature();
  if (sigs.every((x) => x === sig)) return 0;
  let seen = db.query('SELECT sig, since FROM activity_bank WHERE id = 1').get() as { sig: string; since: number };
  if (seen.sig !== sig) { db.query('UPDATE activity_bank SET sig = ?, since = ? WHERE id = 1').run(sig, now); seen = { sig, since: now }; }
  const answered = holdSince(), due = Math.max(seen.since + QUIET, answered > 0 ? answered + ANSWER_HOLD_MS : 0);
  // Overdue for more than a minute: the worker is not taking it (stopped, or the rule is off there), so say nothing.
  return due - now > DUE_WITHIN || now - due > OVERDUE ? 0 : Math.max(1, due - now);
}

// What a row is about in words, and where the owner finds what it made.
function about(r: Row) {
  const job = JOB_KINDS.includes(r.kind), ref = job ? jobRef(r.subject) : r.kind === 'propose-projects' ? `R-${String(r.subject).padStart(2, '0')}` : '';
  const role = `${ref}${r.title ? `, ${r.title}` : ''}`;
  const name = job ? (r.jtitle !== null ? (r.jtitle !== '' && r.jcompany ? `${r.jtitle} at ${r.jcompany}` : r.jtitle || r.jcompany || '') : r.title) : r.kind === 'read-source' ? (r.stitle ?? r.title) : '';
  const named = (s: string) => `${s} ${ref}${name ? `, ${name}` : ''}`;
  const source = name || 'a source';
  const what = { 'read-source': `Reading ${source}`, 'read-posting': named('Reading the posting for'), 'write-resume': named('Writing the resume for'),
    'draft-messages': named('Drafting messages for'), 'write-profile': 'Writing your profile', 'write-reply': 'Writing a reply in Talk', 'check-watchlist': 'Checking your watchlist',
    'propose-projects': `Suggesting projects for ${role}` }[r.kind];
  const gone = (job && r.jtitle === null) || (r.kind === 'read-source' && r.stitle === null) || (r.kind === 'propose-projects' && r.rid === null);
  const link = gone ? '' : { 'read-source': `/source/${r.subject}`, 'read-posting': `/job/${r.subject}`, 'write-resume': `/job/${r.subject}${r.state === 'done' ? '/resume' : ''}`,
    'draft-messages': `/job/${r.subject}`, 'write-profile': '/profile', 'write-reply': '/talk', 'check-watchlist': '/jobs', 'propose-projects': `/record/role/${r.subject}` }[r.kind];
  // The digest's words for a finished row: what it made, or that it failed.
  const line = r.state === 'done'
    ? { 'read-source': `${source} was read`, 'read-posting': `the posting for ${ref} was read`, 'write-resume': `the resume for ${ref} is ready`, 'draft-messages': `messages for ${ref} are drafted`,
      'write-profile': 'your profile is written', 'write-reply': 'a reply is waiting in Talk', 'check-watchlist': r.result ? `the watchlist was checked: ${lower(r.result)}` : 'the watchlist was checked',
      'propose-projects': r.result ? `${firstLower(lower(r.result))} for ${ref}` : `projects are suggested for ${ref}` }[r.kind]
    : { 'read-source': `reading ${source} failed`, 'read-posting': `reading the posting for ${ref} failed`, 'write-resume': `the resume for ${ref} couldn’t be written`, 'draft-messages': `messages for ${ref} couldn’t be drafted`,
      'write-profile': 'your profile couldn’t be written', 'write-reply': 'no reply was written in Talk', 'check-watchlist': 'the watchlist check failed',
      'propose-projects': `projects couldn’t be suggested for ${ref}` }[r.kind];
  return { ref, what, link, line };
}

// GET /activity: one query for the rows in view, one for the usual durations. busy is true while anything waits or
// runs that the worker will take (a resume waits behind its posting's reading, so that alone is not work in hand).
export function activity(now: number, signature: () => string = () => ''): Activity {
  const rows = db.query(`SELECT a.*, j.title AS jtitle, j.company AS jcompany, j.fit AS jfit, j.status AS jstatus, s.title AS stitle, ro.id AS rid,
      (SELECT at FROM activity_seen WHERE id = 1) AS seen
    FROM activity a
    LEFT JOIN jobs j ON a.kind IN ('read-posting', 'write-resume', 'draft-messages') AND j.id = a.subject
    LEFT JOIN sources s ON a.kind = 'read-source' AND s.id = a.subject
    LEFT JOIN roles ro ON a.kind = 'propose-projects' AND ro.id = a.subject
    WHERE a.state IN ('waiting', 'running') OR (a.state = 'failed' AND a.cleared_at = 0)
      OR a.id IN (SELECT id FROM activity WHERE state = 'done' AND by_hand = 0 ORDER BY ended_at DESC LIMIT 20)
      OR a.id IN (SELECT id FROM activity WHERE state IN ('done', 'failed') AND by_hand = 0 AND ended_at > (SELECT at FROM activity_seen WHERE id = 1) ORDER BY ended_at DESC LIMIT 20)`).all() as Row[];
  // When each kind last changed: what the screens key their reloads on.
  const changes = db.query('SELECT kind, max(max(asked_at, started_at, ended_at, cleared_at)) AS at FROM activity GROUP BY kind').all() as { kind: string; at: number }[];
  const ended = db.query('SELECT max(ended_at) AS at FROM activity').get() as { at: number | null };
  const times = usual(), open = rows.filter((r) => r.state === 'waiting' || r.state === 'running');
  const takes = (r: Row) => !(r.kind === 'write-resume' && r.state === 'waiting' && r.jstatus !== 'done');
  // The place in line, as the worker takes work: one at a time in each loop, in its own order.
  const ahead = (r: Row): number => {
    if (r.state !== 'waiting') return -1;
    if (MAIN_LINE.includes(r.kind)) {
      const rank = MAIN_LINE.indexOf(r.kind);
      return open.filter((o) => MAIN_LINE.includes(o.kind) && o !== r && (o.state === 'running' || MAIN_LINE.indexOf(o.kind) < rank || (o.kind === r.kind && o.subject < r.subject))).length;
    }
    // Resumes are written best fit first; the others in the order they were asked for.
    const before = (o: Row) => r.kind === 'write-resume' ? (o.jfit ?? -1) > (r.jfit ?? -1) || ((o.jfit ?? -1) === (r.jfit ?? -1) && o.subject < r.subject) : o.subject < r.subject;
    return open.filter((o) => o.kind === r.kind && o !== r && takes(o) && (o.state === 'running' || before(o))).length;
  };
  const item = (r: Row): Item => {
    const a = about(r), at = r.state === 'waiting' ? r.asked_at : r.state === 'running' ? r.started_at : r.ended_at;
    return { id: String(r.id), kind: r.kind, subject: String(r.subject), ref: a.ref, what: a.what, status: r.state, ahead: ahead(r), stage: r.stage,
      since: Math.max(0, now - at), took: r.state === 'done' && r.started_at > 0 ? Math.max(0, r.ended_at - r.started_at) : -1, usual: times.get(r.kind) ?? -1,
      reason: r.state === 'failed' ? r.reason || 'No reason was given.' : '', link: a.link, endedAt: r.ended_at };
  };
  const order = (a: Item, b: Item) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : b.status === 'running' ? 1 : 0) || (a.ahead - b.ahead) || Number(a.id) - Number(b.id);
  const seen = rows[0]?.seen ?? seenAt(), busy = open.some(takes);
  return {
    busy,
    lastEnded: ended.at ?? 0,
    lastChanged: Math.max(0, ...changes.map((c) => c.at)),
    changes,
    dueIn: busy ? 0 : dueIn(now, signature),
    items: [...open.map(item).sort(order), ...rows.filter((r) => r.state === 'failed' && r.cleared_at === 0).sort((a, b) => b.ended_at - a.ended_at).map(item)],
    done: rows.filter((r) => r.state === 'done').sort((a, b) => b.ended_at - a.ended_at || b.id - a.id).slice(0, 20).map(item),
    digest: rows.filter((r) => (r.state === 'done' || r.state === 'failed') && r.ended_at > seen).sort((a, b) => a.ended_at - b.ended_at || a.id - b.id).slice(-20)
      .map((r) => ({ id: String(r.id), line: about(r).line, link: about(r).link, endedAt: r.ended_at })),
  };
}

// For a test server only (server.ts offers it under --stub-github): sets a piece of work's own status column as the
// worker would, so the screens can be tried without a model, and the triggers log it. to: queued | running | done |
// failed; '' when moved, else why not. `resume` is a resume's text, kept before a write-resume is marked done.
export function stubStep(kind: Kind, subject: number, to: string, note: string, stage: string, resume = ''): string {
  const f = FOLLOW.find((x) => x.kind === kind);
  if (!f) return 'No such kind of work.';
  if (!['queued', 'running', 'done', 'failed'].includes(to)) return 'Say queued, running, done or failed.';
  const value = to === 'done' ? f.done : to;
  if (kind === 'write-resume' && to === 'done' && resume) setResume(subject, resume, null, 'written', 'Written for this posting.');
  if (db.query(`UPDATE ${f.table} SET ${f.column} = ?, ${f.note} = ? WHERE id = ?`).run(value, note, subject).changes === 0) return 'Nothing to move.';
  if (to === 'running' && stage) setStage(kind, subject, stage);
  return '';
}

follow(Date.now());
