// `bun test lib`: starting a new record (lib/reset.ts). The unit tests run on the scratch database and the scratch data
// folder (lib/scratch.ts); the route test starts server.ts on a database of its own. Every person, employer and number
// here is invented.
import { afterAll, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, reset as emptyAll, role, fact } from './scratch.ts';
import { nextId } from './db.ts';
import { inData } from './paths.ts';
import './standing.ts';
import './origins.ts';
import './sittings.ts';
import './repoactivity.ts';
import './activity.ts';
import './stories.ts';
import './you.ts';
import './nextquestion.ts';
import { CONFIRM, DERIVED, NOT_READ, RECORD, RESET_IN_PLACE, lastReset, resetRecord, sameSite, workInHand } from './reset.ts';
import { reprintSent } from './jobs.ts';
import { startServer } from './testserver.ts';

setDefaultTimeout(60_000);

const SENT_RESUME = '# Avery Lindqvist\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console.';
const UNSENT_RESUME = '# Avery Lindqvist\n\n## Experience\n### Senior Engineer, Quillfeather Labs\n- Rebuilt the quoting API.';
const ANALYSIS = JSON.stringify({ verdict: 'A fit.', requirements: [], strengths: [], risks: [], changes: [], gaps: [] });
const has = (t: string) => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) !== null;
const n = (t: string, where = '1') => (db.query(`SELECT count(*) AS n FROM ${t} WHERE ${where}`).get() as { n: number }).n;
const job = (id: number) => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, string | number>;
let sentPdf = '', unsentPdf = '';

// A record with something in every table the reset empties, two jobs (one sent, one not), and the data folder's files.
function seed() {
  emptyAll();
  for (const t of ['activity', 'record_resets', 'companies', 'leads', 'kept_words', 'story_practice', 'interview_questions']) if (has(t)) db.run(`DELETE FROM ${t}`);
  db.run("UPDATE profile SET body = '# Profile', gaps = 'A gap', status = 'done', signature = 'abc', updated_at = 5 WHERE id = 1");
  db.run("UPDATE direction SET body = 'Platform roles, remote.' WHERE id = 1");
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 7, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  db.run("INSERT INTO sources (id, kind, title, body, status, created_at) VALUES (4, 'text', 'Old resume', 'Some text.', 'done', 1)");
  const project = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Dispatch console', 1) RETURNING id").get() as { id: number }).id;
  const f1 = fact(1, 'Built the dispatch console.', '640 users', 'TypeScript');
  const f2 = fact(7, 'Rebuilt the quoting API.', '', 'Go');
  db.query('UPDATE facts SET project_id = ?, source_id = 4 WHERE id = ?').run(project, f1);
  db.query("UPDATE facts SET id = 40 WHERE id = ?").run(f2);
  // The project is kept: deleting it writes kept marks onto its facts first (lib/standing.ts, project_kept_gone).
  db.query("INSERT INTO project_standing (project_id, mark) VALUES (?, 'kept')").run(project);
  db.query("INSERT INTO fact_standing (fact_id, mark, marked_by) VALUES (40, 'public', 'owner')").run();
  db.query("INSERT INTO fact_origins (fact_id, kind, ref_id, span_start, span_end, quote, added_at) VALUES (?, 'source', 4, 0, 4, 'Some', 1)").run(f1);
  db.run("INSERT INTO repo_activity (key, role_id, commits, read_at) VALUES ('acme/console', 1, 12, 1)");
  db.run("INSERT INTO talk (who, body, created_at) VALUES ('you', 'I led the console.', 1)");
  const sitting = (db.query("INSERT INTO capture_sittings (role_id, started_at) VALUES (1, 1) RETURNING id").get() as { id: number }).id;
  db.query("INSERT INTO capture_turns (sitting_id, who, step, text, at) VALUES (?, 'owner', 'answer', 'Six of us.', 2)").run(sitting);
  db.run("INSERT INTO project_proposals (role_id, title, created_at) VALUES (7, 'Quoting', 1)");
  db.run("INSERT INTO deleted_facts (text, at) VALUES ('an old fact', 1)");
  db.run("INSERT INTO answered (question, at) VALUES ('Who used it?', 1)");
  db.run("INSERT INTO raised_questions (key, kind, text, raised_at, answered_at, answer) VALUES ('k1', 'skill', 'Is Go yours?', 1, 2, 'yes')");
  db.run("INSERT INTO linkedin_positions (company, title, read_at) VALUES ('Harborlight Systems', 'Director', 1)");
  db.run("INSERT INTO skills (key, name, mark, added_at) VALUES ('go', 'Go', 'confident', 1)");
  db.run('UPDATE skills_review SET reviewed_at = 9 WHERE id = 1');
  db.run('UPDATE skills_due SET marked_at = 9, done_at = 8 WHERE id = 1');
  db.run("INSERT INTO derived_lines (key, verdict) VALUES ('results:latency', 'kept')");
  db.run("INSERT INTO queue_snoozes (key, until) VALUES ('quiet:1', 99)");
  db.run("INSERT INTO companies (name, ats, token) VALUES ('Nimbus Yard', 'greenhouse', 'nimbus')");
  db.run("INSERT INTO leads (company_id, ext, title, first_seen, score, reason) VALUES (1, 'x1', 'Platform Engineer', 1, 72, 'Close to the console work.')");
  // Job 1 was sent; job 2 was read and written but not sent.
  mkdirSync(join(inData('resumes'), '1-aaaaaaaaaaaaaaaa'), { recursive: true });
  mkdirSync(join(inData('resumes'), '2-bbbbbbbbbbbbbbbb'), { recursive: true });
  sentPdf = join(inData('resumes'), '1-aaaaaaaaaaaaaaaa', 'Avery Lindqvist - Harborlight.pdf');
  unsentPdf = join(inData('resumes'), '2-bbbbbbbbbbbbbbbb', 'Avery Lindqvist - Nimbus Yard.pdf');
  writeFileSync(sentPdf, '%PDF-1.4 sent');
  writeFileSync(unsentPdf, '%PDF-1.4 unsent');
  db.query(`INSERT INTO jobs (id, url, posting, title, company, place, status, fit, analysis, resume, links, ats, pdf, outcome, applied_at, contact, created_at, outreach, outreach_status, bank_sig, terms_raw, resume_status, edited)
    VALUES (1, 'https://jobs.example.com/1', 'Lead the platform.', 'Platform Lead', 'Harborlight Systems', 'Remote', 'done', 81, ?, ?, '{"1":["fact:1"]}', '{"score":90}', ?, 'applied', 5, 'Dana', 1, '[{"door":"a"}]', 'done', 'sig1', '["Go"]', 'done', 0)`).run(ANALYSIS, SENT_RESUME, sentPdf);
  db.query(`INSERT INTO jobs (id, url, posting, title, company, place, status, fit, analysis, resume, links, ats, pdf, outcome, contact, outcome_note, created_at, outreach, outreach_status, outreach_note, bank_sig, terms_raw, resume_status, resume_note, edited, pages, salary)
    VALUES (2, 'https://jobs.example.com/2', 'Build the quoting service.', 'Senior Engineer', 'Nimbus Yard', 'Duluth, MN', 'done', 64, ?, ?, '{"1":["fact:40"]}', '{"score":70}', ?, '', 'Sam', 'Met at a meetup', 2, '[{"door":"b"}]', 'done', 'ok', 'sig2', '["Go"]', 'done', 'fine', 1, 1, '$150K')`).run(ANALYSIS, UNSENT_RESUME, unsentPdf);
  db.run("INSERT INTO resume_versions (job_id, n, sig, resume, why, reason, made_at, sent) VALUES (1, 1, 's', 'A', 'written', 'r', 1, 1), (1, 2, 's', 'B', 'edited', 'r', 2, 0), (2, 1, 's', 'C', 'written', 'r', 1, 0)");
  db.run("INSERT INTO resume_suggestions (job_id, old, new) VALUES (1, 'a', 'b'), (2, 'c', 'd')");
  db.run("INSERT INTO skills_due_jobs (job_id, tries) VALUES (2, 1)");
  // The project's spoken story and two practices of it; two questions from interviews, one answered by the project.
  db.query("UPDATE projects SET spoken = 'I built the dispatch console.', spoken_wrote = 'I built the dispatch console.' WHERE id = ?").run(project);
  db.query('INSERT INTO story_practice (project_id, at, seconds) VALUES (?, 1, NULL), (?, 2, 95)').run(project, project);
  db.query("INSERT INTO interview_questions (text, job_id, added_at, project_id) VALUES ('Tell me about a system you built.', 1, 3, ?), ('Why this team?', 1, 4, NULL)").run(project);
  db.run("INSERT INTO activity (kind, subject, title, asked_at, ended_at, state) VALUES ('write-spoken', 1, 'Dispatch console', 1, 2, 'done'), ('read-source', 4, 'Old resume', 1, 2, 'done'), ('write-resume', 2, '', 1, 2, 'done'), ('write-resume', 1, '', 1, 2, 'done'), ('read-posting', 2, '', 1, 2, 'done')");
  // The data folder's files.
  for (const d of ['inbox', 'repos/acme__console', 'public', 'codex']) mkdirSync(inData(d), { recursive: true });
  writeFileSync(inData('profile.md'), '# Profile\n');
  writeFileSync(inData('unslop.md'), 'before and after\n');
  writeFileSync(inData('inbox/old resume.pdf'), 'pdf');
  writeFileSync(inData('repos/acme__console/README'), 'readme');
  writeFileSync(inData('egg.db.before-unslop'), 'copy');
  writeFileSync(inData('public/collection.md'), 'Public text.');
  writeFileSync(inData('codex/auth.json'), '{}');
}

beforeEach(seed);

test('the wrong phrase is refused in words and nothing changes', () => {
  for (const said of ['', 'Start a new record', 'start a new record.', undefined, 1]) {
    expect(resetRecord(said, 1000)).toEqual({ ok: false, status: 400, error: `Type “${CONFIRM}” to confirm. Nothing was deleted.` });
  }
  expect([n('roles'), n('facts'), n('sources'), existsSync(inData('profile.md'))]).toEqual([2, 2, 1, true]);
});

test('it is refused while work waits or runs, and goes on once nothing does', () => {
  db.run("UPDATE sources SET status = 'queued' WHERE id = 4");
  db.run("UPDATE jobs SET outreach_status = 'running' WHERE id = 1");
  expect(workInHand()).toEqual(['a source being read', 'messages being drafted']);
  const r = resetRecord(CONFIRM, 1000);
  expect(r).toEqual({ ok: false, status: 409, error: 'Work is still waiting or running: a source being read, messages being drafted. Wait for it to finish, then try again. Nothing was deleted.' });
  expect([n('roles'), n('facts'), lastReset()]).toEqual([2, 2, 0]);
  // A resume queued behind a reading that did not finish is not work the worker will take.
  db.run("UPDATE sources SET status = 'done'");
  db.run("UPDATE jobs SET outreach_status = 'done'");
  db.run("UPDATE jobs SET resume_status = 'queued', status = 'failed' WHERE id = 2");
  expect(workInHand()).toEqual([]);
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
});

test('the record and everything derived from it are deleted; the owner, the direction and the job tracker stay', () => {
  db.run("INSERT INTO profile_answers (question_key, question, words, at) VALUES ('key', 'What changed?', 'We shipped the console.', 1)");
  const r = resetRecord(CONFIRM, 1_700_000_000_000);
  expect(r).toEqual({ ok: true, reset: {
    deleted: { roles: 2, projects: 1, facts: 2, sources: 1, answers: 3, unsentResumes: 1 },
    kept: { jobs: 2, sentResumes: 1 }, at: 1_700_000_000_000, notDeleted: [] } });
  for (const t of [...RECORD, ...DERIVED]) expect([t, n(t)]).toEqual([t, 0]);
  expect(db.query('SELECT body, gaps, status, signature, updated_at FROM profile WHERE id = 1').get()).toEqual({ body: '', gaps: '', status: 'none', signature: '', updated_at: 0 });
  expect(db.query('SELECT reviewed_at FROM skills_review').get()).toEqual({ reviewed_at: 0 });
  expect(db.query('SELECT marked_at, done_at FROM skills_due').get()).toEqual({ marked_at: 0, done_at: 0 });
  expect((db.query('SELECT body FROM direction').get() as { body: string }).body).toBe('Platform roles, remote.');
  expect((db.query('SELECT name FROM person').get() as { name: string }).name).toBe('Avery Lindqvist');
  expect([n('companies'), n('leads'), n('jobs')]).toEqual([1, 1, 2]);
  // A found posting keeps what was found and loses its quick score, written from the old profile.
  expect(db.query('SELECT title, score, reason FROM leads').get()).toEqual({ title: 'Platform Engineer', score: -1, reason: '' });
  // The work log keeps the sent job's rows and the posting's reading, and loses the record's and the unsent resume's.
  expect(db.query('SELECT kind, subject FROM activity ORDER BY id').all()).toEqual([{ kind: 'write-resume', subject: 1 }, { kind: 'read-posting', subject: 2 }]);
  expect(lastReset()).toBe(1_700_000_000_000);
  // The questions asked in interviews are the job tracker's history: kept, with their link to a story cleared.
  expect(db.query('SELECT text, job_id, project_id FROM interview_questions ORDER BY id').all()).toEqual([
    { text: 'Tell me about a system you built.', job_id: 1, project_id: null }, { text: 'Why this team?', job_id: 1, project_id: null }]);
});

test('a spoken story being written is work in hand, and the reset waits for it', () => {
  db.run("UPDATE projects SET spoken_status = 'queued'");
  expect(workInHand()).toEqual(['a spoken story being written']);
  expect(resetRecord(CONFIRM, 1000).ok).toBe(false);
  db.run("UPDATE projects SET spoken_status = 'failed'");
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
});

// The tables a new record leaves as they are. A table not named here or in the reset's lists fails the test below until
// someone decides which it is.
const KEPT = ['person', 'direction', 'jobs', 'companies', 'leads', 'discovery', 'resume_versions', 'resume_suggestions', 'id_floor', 'sqlite_sequence',
  'record_written', 'activity_seen', 'record_resets', 'interview_questions'];

test('every table in the database is either emptied, put back to its start, or kept on purpose', () => {
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const named = new Set([...RECORD, ...DERIVED, ...RESET_IN_PLACE, ...KEPT]);
  expect(tables.filter((t) => !named.has(t))).toEqual([]);
});

test('a second new record takes a greater mark, even when the clock is behind the first', () => {
  expect(resetRecord(CONFIRM, 5000).ok).toBe(true);
  const second = resetRecord(CONFIRM, 1000);
  expect(second.ok && second.reset.at).toBe(5001);
  expect(lastReset()).toBe(5001);
});

test('a symbolic link in the repositories folder is removed, and what it points at stays', () => {
  const target = mkdtempSync(join(tmpdir(), 'egg-link-target-'));
  writeFileSync(join(target, 'keep.txt'), 'mine');
  symlinkSync(target, inData('repos/linked'));
  try {
    expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
    expect(existsSync(inData('repos/linked'))).toBe(false);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('only a JSON request from the studio’s own host may start a new record', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const json = { 'content-type': 'application/json' };
  expect(sameSite(h(json), 'http://127.0.0.1:8787/record/reset')).toBe('');
  expect(sameSite(h({ 'content-type': 'application/json; charset=utf-8', origin: 'http://127.0.0.1:42685' }), 'http://127.0.0.1:8787/record/reset')).toBe('');
  // In the container the Worker sends it to http://app/ with no Origin.
  expect(sameSite(h(json), 'http://app/record/reset')).toBe('');
  const foreign = 'A new record can be started only from the studio’s own screens. Nothing was deleted.';
  for (const origin of ['https://example.com', 'null', 'http://127.0.0.1.example.com:8787', 'not an address']) expect(sameSite(h({ ...json, origin }), 'http://127.0.0.1:8787/record/reset')).toBe(foreign);
  for (const type of ['', 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) expect(sameSite(h({ 'content-type': type }), 'http://127.0.0.1:8787/record/reset')).toBe('Send the request as JSON. Nothing was deleted.');
});

test('a sent job stays whole; a job not yet sent keeps its posting and tracking and waits to be read again', () => {
  const before = job(1);
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
  expect(job(1)).toEqual(before);
  expect(db.query('SELECT n, sent FROM resume_versions WHERE job_id = 1 ORDER BY n').all()).toEqual([{ n: 1, sent: 1 }, { n: 2, sent: 0 }]);
  expect(n('resume_suggestions', 'job_id = 1')).toBe(1);
  const j = job(2);
  expect({ url: j.url, posting: j.posting, title: j.title, company: j.company, place: j.place, contact: j.contact, outcome_note: j.outcome_note, pages: j.pages, salary: j.salary, outcome: j.outcome })
    .toEqual({ url: 'https://jobs.example.com/2', posting: 'Build the quoting service.', title: 'Senior Engineer', company: 'Nimbus Yard', place: 'Duluth, MN', contact: 'Sam', outcome_note: 'Met at a meetup', pages: 1, salary: '$150K', outcome: '' });
  expect({ status: j.status, note: j.note, fit: j.fit, analysis: j.analysis, resume: j.resume, links: j.links, ats: j.ats, pdf: j.pdf, edited: j.edited, bank_sig: j.bank_sig, terms_raw: j.terms_raw,
    resume_status: j.resume_status, resume_note: j.resume_note, outreach: j.outreach, outreach_status: j.outreach_status, outreach_note: j.outreach_note })
    .toEqual({ status: 'failed', note: NOT_READ, fit: -1, analysis: '', resume: '', links: '', ats: '', pdf: '', edited: 0, bank_sig: '', terms_raw: '[]', resume_status: '', resume_note: '', outreach: '', outreach_status: '', outreach_note: '' });
  expect([n('resume_versions', 'job_id = 2'), n('resume_suggestions', 'job_id = 2')]).toEqual([0, 0]);
  // It is not in the reading queue: the worker does not read it against an empty record.
  expect(workInHand()).toEqual([]);
});

test('the files that came from the record go; the sent PDF, the public text and the sign-in stay', () => {
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
  for (const f of ['profile.md', 'unslop.md', 'egg.db.before-unslop', 'inbox/old resume.pdf', 'repos/acme__console']) expect([f, existsSync(inData(f))]).toEqual([f, false]);
  // The inbox stays as a folder: the server lists it.
  expect([existsSync(inData('inbox')), readdirSync(inData('inbox'))]).toEqual([true, []]);
  expect([existsSync(sentPdf), existsSync(unsentPdf)]).toEqual([true, false]);
  expect(readFileSync(inData('public/collection.md'), 'utf8')).toBe('Public text.');
  expect(existsSync(inData('codex/auth.json'))).toBe(true);
});

test('a file that cannot be deleted is said in the result, and the reset still happens', () => {
  if (process.getuid?.() === 0) return; // root deletes anything
  writeFileSync(inData('repos/acme__console/LOCKED'), 'x');
  chmodSync(inData('repos/acme__console'), 0o500);
  try {
    const r = resetRecord(CONFIRM, 1000);
    expect(r.ok && r.reset.notDeleted).toEqual(['repos/acme__console']);
    expect(n('facts')).toBe(0);
  } finally { chmodSync(inData('repos/acme__console'), 0o700); rmSync(inData('repos/acme__console'), { recursive: true, force: true }); }
});

test('reference numbers are never reused: a new role, fact, project and source take ids above every id before the reset', () => {
  const high = (t: string) => (db.query(`SELECT max(id) AS m FROM ${t}`).get() as { m: number }).m;
  const before = { roles: high('roles'), facts: high('facts'), projects: high('projects'), sources: high('sources') };
  expect(before).toEqual({ roles: 7, facts: 40, projects: before.projects, sources: 4 });
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
  const r = db.query(`INSERT INTO roles (id, company, title) VALUES (${nextId('roles')}, 'Lantern Notes', 'Founder') RETURNING id`).get() as { id: number };
  const f = db.query(`INSERT INTO facts (id, role_id, kind, text, created_at) VALUES (${nextId('facts')}, ?, 'other', 'Started the notes app.', 1) RETURNING id`).get(r.id) as { id: number };
  const p = db.query("INSERT INTO projects (role_id, title) VALUES (?, 'Notes') RETURNING id").get(r.id) as { id: number };
  const s = db.query("INSERT INTO sources (kind, title, body, created_at) VALUES ('text', 'New', 'x', 1) RETURNING id").get() as { id: number };
  expect(r.id).toBeGreaterThan(before.roles);
  expect(f.id).toBeGreaterThan(before.facts);
  expect(p.id).toBeGreaterThan(before.projects);
  expect(s.id).toBeGreaterThan(before.sources);
});

test('a sent resume whose PDF is gone prints again from its stored text alone, with its reading and check left as they were', async () => {
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
  rmSync(sentPdf, { force: true });
  db.run("UPDATE jobs SET pdf = '' WHERE id = 1");
  // A stand-in for Chrome: it keeps the page it was asked to print and writes a one-page PDF.
  const dir = mkdtempSync(join(tmpdir(), 'egg-chrome-')), page = join(dir, 'page.html');
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
  writeFileSync(join(dir, 'one.pdf'), pdf);
  writeFileSync(join(dir, 'chrome'), `#!/bin/sh\nfor a in "$@"; do case "$a" in --print-to-pdf=*) out="\${a#--print-to-pdf=}";; file://*) src="\${a#file://}";; esac; done\ncp "$src" "${page}"\ncp "${join(dir, 'one.pdf')}" "$out"\n`, { mode: 0o755 });
  const was = process.env.CHROME;
  process.env.CHROME = join(dir, 'chrome');
  try {
    const before = job(1);
    await reprintSent(1);
    const after = job(1);
    expect(String(after.pdf).startsWith(join(inData('resumes'), '1-'))).toBe(true);
    expect(existsSync(String(after.pdf))).toBe(true);
    expect({ ...after, pdf: '' }).toEqual({ ...before, pdf: '' });
    // With its employer gone from the record, the heading prints whole on one line: every word as it was sent.
    expect(readFileSync(page, 'utf8')).toContain('<h3>Director of Engineering, Harborlight Systems</h3>');
  } finally {
    if (was === undefined) delete process.env.CHROME; else process.env.CHROME = was;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a sent resume whose file is there already is pointed at again, never printed over', async () => {
  expect(resetRecord(CONFIRM, 1000).ok).toBe(true);
  const { pdfPath } = await import('./pdf.ts');
  const there = pdfPath(job(1) as never, SENT_RESUME);
  writeFileSync(there, '%PDF-1.4 as it went out');
  db.run("UPDATE jobs SET pdf = '' WHERE id = 1");
  const was = process.env.CHROME;
  process.env.CHROME = '/nonexistent/chrome';
  try {
    await reprintSent(1);
    expect(job(1).pdf).toBe(there);
    expect(readFileSync(there, 'utf8')).toBe('%PDF-1.4 as it went out');
  } finally { if (was === undefined) delete process.env.CHROME; else process.env.CHROME = was; }
});

// ---------- The route ----------
let server: ReturnType<typeof Bun.spawn> | undefined;
const routeDir = mkdtempSync(join(tmpdir(), 'egg-reset-route-'));
afterAll(async () => { server?.kill(); await server?.exited; rmSync(routeDir, { recursive: true, force: true }); });

test('POST /record/reset refuses the wrong phrase and work in hand, then says what it deleted and kept', async () => {
  const file = join(routeDir, 'egg.db');
  const started = await startServer({ DB: file, EGG_INBOX: join(routeDir, 'inbox') });
  server = started.server;
  const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${started.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  expect((await call('POST', '/roles', { company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', end: '' })).status).toBe(201);
  expect((await call('POST', '/facts', { roleId: 1, kind: 'accomplishment', text: 'Built the dispatch console.' })).status).toBe(201);
  expect((await call('POST', '/jobs', { url: 'https://jobs.example.com/initech/platform', posting: '' })).status).toBe(201);
  expect(await call('POST', '/record/reset', { confirm: 'yes' })).toEqual({ status: 400, body: { error: `Type “${CONFIRM}” to confirm. Nothing was deleted.` } });
  expect(await call('POST', '/record/reset', [])).toEqual({ status: 400, body: { error: 'Send the request as a JSON object.' } });
  // A page on another site, or a form, is refused before anything is read, with nothing deleted.
  const foreign = await fetch(`${started.base}/record/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify({ confirm: CONFIRM }) });
  expect([foreign.status, await foreign.json()]).toEqual([403, { error: 'A new record can be started only from the studio’s own screens. Nothing was deleted.' }]);
  const form = await fetch(`${started.base}/record/reset`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ confirm: CONFIRM }) });
  expect(form.status).toBe(403);
  expect(((await call('GET', '/tree')).body.facts as unknown[]).length).toBe(1);
  // The new job waits to be read.
  expect(await call('POST', '/record/reset', { confirm: CONFIRM })).toEqual({ status: 409, body: { error: 'Work is still waiting or running: a posting being read. Wait for it to finish, then try again. Nothing was deleted.' } });
  expect((await call('POST', '/test/work', { kind: 'read-posting', id: 1, to: 'failed', note: 'The page asked for a sign-in.' })).status).toBe(200);
  // The job was sent with a resume that cites fact 1, and its PDF is on disk.
  const pdf = join(routeDir, 'resumes', '1-cccccccccccccccc', 'Avery Lindqvist.pdf');
  mkdirSync(join(routeDir, 'resumes', '1-cccccccccccccccc'), { recursive: true });
  writeFileSync(pdf, '%PDF-1.4 sent');
  const w = new Database(file);
  w.query("UPDATE jobs SET outcome = 'applied', applied_at = 5, resume = ?, links = ?, pdf = ? WHERE id = 1").run(SENT_RESUME, JSON.stringify({ '- Built the dispatch console.': ['fact:1'] }), pdf);
  w.close();
  // From the screens' own host, on another port, as on a development machine.
  const res = await fetch(`${started.base}/record/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${new URL(started.base).port === '1' ? '2' : '1'}` }, body: JSON.stringify({ confirm: CONFIRM }) });
  const r = { status: res.status, body: (await res.json()) as Record<string, unknown> };
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ ok: true, deleted: { roles: 1, projects: 0, facts: 1, sources: 0, answers: 0, unsentResumes: 0 }, kept: { jobs: 1, sentResumes: 1 }, notDeleted: [] });
  expect((await call('GET', '/tree')).body).toMatchObject({ roles: [], facts: [] });
  const d = new Database(file, { readonly: true });
  try { expect(d.query('SELECT count(*) AS n FROM record_resets').get()).toEqual({ n: 1 }); } finally { d.close(); }
  // The sent resume is still shown, and its PDF still downloads.
  expect((await call('GET', '/jobs/1/resume')).status).toBe(200);
  expect((await call('GET', '/jobs/1')).body.resume).toBe(SENT_RESUME);
  const got = await fetch(`${started.base}/jobs/1/resume.pdf`);
  expect([got.status, await got.text()]).toEqual([200, '%PDF-1.4 sent']);
}, 120_000);
