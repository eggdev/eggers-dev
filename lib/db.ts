// The knowledge bank's store: one SQLite file, shared by server.ts (the API) and worker.ts (ingestion).
// Its path is DB (the test runner passes a scratch one); the default is in the data folder (lib/paths.ts), which is gitignored.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DB_FILE } from './paths.ts';

const path = DB_FILE;
if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
export const db = new Database(path);
db.run('PRAGMA busy_timeout = 5000');
// The server and the worker open the file at the same moment, and switching to WAL does not
// wait on the other's lock as an ordinary write does: try again for a couple of seconds.
for (let tries = 0; ; tries++) {
  try { db.run('PRAGMA journal_mode = WAL'); break; } catch (e) { if (tries === 20) throw e; Bun.sleepSync(100); }
}

// A source is something to read: pasted text, a file in the inbox, or a git repository.
// status: queued → running → done | failed. note says what happened, in words.
db.run(`CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL)`);
// start and end are YYYY-MM; an empty end is the present.
db.run(`CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL,
  start TEXT NOT NULL DEFAULT '', end TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '')`);
// A fact is one true thing about the person's work: `text` is its one-sentence headline and
// `detail` the story behind it. What the person supplies is taken as true, so there is no review
// step. status only records where the wording came from: 'proposed' is as a source was read
// (a re-read replaces it), 'confirmed' is written or edited by the person (a re-read keeps it).
db.run(`CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY, role_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
  source_id INTEGER, status TEXT NOT NULL DEFAULT 'proposed', created_at INTEGER NOT NULL)`);

for (const column of ["detail TEXT NOT NULL DEFAULT ''"]) {
  try { db.run(`ALTER TABLE facts ADD COLUMN ${column}`); } catch { /* already there */ }
}
// What kind of work a role or project was, which decides how much it counts as evidence for a job
// (lib/jobs.ts). standing: employer | own | contract | personal. reach: live | retired | never.
// Empty means the person has not said; it then counts as middling, never as full.
// part_of is the employer role a project group belongs to (a repository in that employer's organisation):
// the project then counts as that employer's work.
for (const column of ["standing TEXT NOT NULL DEFAULT ''", "reach TEXT NOT NULL DEFAULT ''", 'part_of INTEGER']) {
  try { db.run(`ALTER TABLE roles ADD COLUMN ${column}`); } catch { /* already there */ }
}
// What the person says about a role so its dates read true on a resume (RESUME-RULES.md, rule 4). note is one
// line of context ("Ran alongside the Acme job, evenings only."); label is Contract or Part-time. Both are
// printed with the role. An end date is the `end` column above. Empty means the person has not said.
for (const column of ["note TEXT NOT NULL DEFAULT ''", "label TEXT NOT NULL DEFAULT ''"]) {
  try { db.run(`ALTER TABLE roles ADD COLUMN ${column}`); } catch { /* already there */ }
}
// The profile: one document written from the whole bank (lib/profile.ts). status is
// none | queued | running | done | failed; signature is the bank's when it was written.
db.run(`CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL DEFAULT '', gaps TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none', note TEXT NOT NULL DEFAULT '', signature TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`);
db.run('INSERT OR IGNORE INTO profile (id) VALUES (1)');

// A job posting measured against the bank (lib/jobs.ts). fit is 0 to 100, or -1 before it is read.
db.run(`CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL DEFAULT '', posting TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued', note TEXT NOT NULL DEFAULT '', fit INTEGER NOT NULL DEFAULT -1,
  analysis TEXT NOT NULL DEFAULT '', resume TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`);

// What became of a job the person tried: applied | interviewed | rejected | no-response | offer, with a note in their words.
// contact is who the person knows there; ats is what reading the resume's PDF back found (lib/pdf.ts); pdf is that file's path.
// resume_status follows the resume being written after a job's first reading: '' | queued | running | done | failed.
// terms_raw is the posting's keywords as first read, kept so the resume step uses the same ones.
for (const column of ["resume_status TEXT NOT NULL DEFAULT ''", "resume_note TEXT NOT NULL DEFAULT ''", "terms_raw TEXT NOT NULL DEFAULT '[]'",
  // bank_sig is the bank's signature when the resume was last written (or last failed): a different bank means the resume is out of date.
  "bank_sig TEXT NOT NULL DEFAULT ''"]) {
  try { db.run(`ALTER TABLE jobs ADD COLUMN ${column}`); } catch { /* already there */ }
}
// outreach is the drafted messages for reaching someone at the company, as JSON (lib/outreach.ts); outreach_status is '' | queued | running | done | failed.
for (const column of ["outreach TEXT NOT NULL DEFAULT ''", "outreach_status TEXT NOT NULL DEFAULT ''", "outreach_note TEXT NOT NULL DEFAULT ''"]) {
  try { db.run(`ALTER TABLE jobs ADD COLUMN ${column}`); } catch { /* already there */ }
}
// edited is 1 once the person has changed the resume by hand: a re-read then asks before writing over it.
for (const column of ['edited INTEGER NOT NULL DEFAULT 0', "outcome TEXT NOT NULL DEFAULT ''", "outcome_note TEXT NOT NULL DEFAULT ''", "contact TEXT NOT NULL DEFAULT ''", "ats TEXT NOT NULL DEFAULT ''", "pdf TEXT NOT NULL DEFAULT ''", 'pages INTEGER NOT NULL DEFAULT 2']) {
  try { db.run(`ALTER TABLE jobs ADD COLUMN ${column}`); } catch { /* already there */ }
}
// The watchlist: companies whose public job boards are read (lib/discover.ts), and the postings found there.
// A lead's score is a quick first sort, -1 until scored. status: new | dismissed | promoted (read fully as a job) | closed (left the board).
db.run(`CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ats TEXT NOT NULL, token TEXT NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', UNIQUE (ats, token))`);
db.run(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, ext TEXT NOT NULL, title TEXT NOT NULL, place TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '', posting TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT -1, reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new', first_seen INTEGER NOT NULL, UNIQUE (company_id, ext))`);
// One row of small settings: whether a check of the watchlist is waiting or running, and when the last one ended.
db.run(`CREATE TABLE IF NOT EXISTS discovery (id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT NOT NULL DEFAULT 'idle', note TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL DEFAULT 0)`);
db.run('INSERT OR IGNORE INTO discovery (id) VALUES (1)');
// When a posting went up (ms, 0 unknown) and the pay it states, for found postings and for jobs;
// and when a job was marked applied, which is what its fourteen days of waiting are counted from.
for (const column of ['posted_at INTEGER NOT NULL DEFAULT 0', "salary TEXT NOT NULL DEFAULT ''"]) {
  try { db.run(`ALTER TABLE leads ADD COLUMN ${column}`); } catch { /* already there */ }
  try { db.run(`ALTER TABLE jobs ADD COLUMN ${column}`); } catch { /* already there */ }
}
try { db.run('ALTER TABLE jobs ADD COLUMN applied_at INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }

// Changes whenever anything the profile is written from changes: a fact's wording, result, skills,
// category or filing, or a role's title, dates, kind of work, note or label. It is how a profile is known to be out of date.
export const bankSignature = () => {
  const facts = db.query('SELECT id, role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all();
  const roles = db.query('SELECT id, company, title, start, end, standing, reach, part_of FROM roles ORDER BY id').all();
  // A role's note and label count only once one is set, so a bank that has none keeps the signature it had
  // before these columns existed, and no resume is written again for nothing.
  const said = db.query("SELECT id, note, label FROM roles WHERE note != '' OR label != '' ORDER BY id").all();
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(said.length ? [facts, roles, said] : [facts, roles])).digest('hex').slice(0, 24);
};

// A role that came with a job title is taken to be an employer until the person says otherwise;
// a project read from a repository is left for them to class.
db.run("UPDATE roles SET standing = 'employer' WHERE standing = '' AND title != '' AND NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.standing != '')");

// Attaches project groups (roles with no job title, read from repositories) to the employer they
// were done for, by two plain signs: the repository sits in the same GitHub organisation as
// repositories already filed under that employer, or its name contains the employer's name.
// A project in the person's own account (`login`) with no such sign is classed a personal project.
// Only fills what is empty: a choice the person made is never changed. Returns how many it attached.
export function associate(login = ''): number {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const repos = db.query("SELECT DISTINCT f.role_id AS role, s.body AS full FROM facts f JOIN sources s ON s.id = f.source_id WHERE s.kind = 'github' AND f.role_id IS NOT NULL").all() as { role: number; full: string }[];
  const employers = roles.filter((r) => r.title !== '');
  const orgOf = new Map<string, number>();
  for (const e of employers) for (const p of repos.filter((x) => x.role === e.id)) orgOf.set(p.full.split('/')[0].toLowerCase(), e.id);
  let n = 0;
  for (const r of roles.filter((x) => x.title === '' && x.part_of === null)) {
    const mine = repos.filter((x) => x.role === r.id).map((x) => x.full);
    if (mine.length === 0) continue;
    const byName = employers.find((e) => squash(e.company).length >= 4 && mine.some((full) => squash(full.split('/')[1] ?? '').includes(squash(e.company))));
    const byOrg = mine.map((full) => orgOf.get(full.split('/')[0].toLowerCase())).find((id) => id !== undefined);
    const parent = byName?.id ?? byOrg;
    if (parent !== undefined) { db.query('UPDATE roles SET part_of = ? WHERE id = ?').run(parent, r.id); n++; }
    else if (login !== '' && r.standing === '' && mine.every((full) => full.split('/')[0].toLowerCase() === login.toLowerCase())) db.query("UPDATE roles SET standing = 'personal' WHERE id = ?").run(r.id);
  }
  return n;
}

export const KINDS = ['accomplishment', 'project', 'responsibility', 'skill', 'education', 'other'] as const;
export type Kind = (typeof KINDS)[number];

export type RoleRow = { id: number; company: string; title: string; start: string; end: string; location: string; summary: string; standing: string; reach: string; part_of: number | null; note: string; label: string };
export type SourceRow = { id: number; kind: 'text' | 'file' | 'repo' | 'github'; title: string; body: string; author: string; status: string; note: string; created_at: number };

export type Extraction = {
  roles: { key: string; company: string; title: string; start: string; end: string; location: string; summary: string }[];
  facts: { roleKey: string; kind: string; text: string; detail: string; metric: string; skills: string[]; evidence: string; replaces?: string }[];
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Questions the person has already answered as far as they can. Everything that writes questions for
// them (the profile, a job's reading, a resume's council, Talk) is shown these and told not to ask again.
db.run('CREATE TABLE IF NOT EXISTS answered (question TEXT PRIMARY KEY, at INTEGER NOT NULL)');
export const answeredQuestions = () => (db.query('SELECT question FROM answered ORDER BY at DESC LIMIT 80').all() as { question: string }[]).map((r) => r.question);
export const ASKED = () => { const q = answeredQuestions(); return q.length === 0 ? '' : `\n\nThe person has already been asked these and answered as far as they can. Do not ask them again, in these words or others, and do not ask for a detail one of them already sought:\n${q.map((x) => `- ${x}`).join('\n')}\n`; };

// Facts the person deleted: a later reading of the same material must not bring them back.
db.run('CREATE TABLE IF NOT EXISTS deleted_facts (text TEXT PRIMARY KEY, at INTEGER NOT NULL)');
export function deleteFact(id: number, now: number) {
  const f = db.query('SELECT text FROM facts WHERE id = ?').get(id) as { text: string } | null;
  if (f) db.query('INSERT OR REPLACE INTO deleted_facts (text, at) VALUES (?, ?)').run(norm(f.text), now);
  db.query('DELETE FROM facts WHERE id = ?').run(id);
}
export const deletedFacts = () => (db.query('SELECT text FROM deleted_facts ORDER BY at DESC LIMIT 200').all() as { text: string }[]).map((r) => r.text);

// Writes what a source said as facts, replacing what an earlier reading of that source wrote
// and leaving alone the facts the person has edited. A role key of `role:<id>` names an existing
// role; any other key names one of the extraction's own, matched to an existing role by
// company and title before a new one is made. Returns how many facts were proposed.
export function applyExtraction(sourceId: number, x: Extraction, now: number): number {
  return db.transaction(() => {
    db.query("DELETE FROM facts WHERE source_id = ? AND status = 'proposed'").run(sourceId);
    const existing = db.query('SELECT * FROM roles').all() as RoleRow[];
    const byKey = new Map<string, number>();
    for (const r of existing) byKey.set(`role:${r.id}`, r.id);
    for (const r of x.roles ?? []) {
      if (!r.company?.trim() || byKey.has(r.key)) continue;
      const same = existing.find((e) => norm(e.company) === norm(r.company) && norm(e.title) === norm(r.title ?? ''));
      if (same) {
        byKey.set(r.key, same.id);
        // Fill what the earlier source left blank; never overwrite what is there.
        db.query(`UPDATE roles SET start = CASE WHEN start = '' THEN ? ELSE start END, end = CASE WHEN end = '' AND start = '' THEN ? ELSE end END,
          location = CASE WHEN location = '' THEN ? ELSE location END, summary = CASE WHEN summary = '' THEN ? ELSE summary END WHERE id = ?`)
          .run(r.start ?? '', r.end ?? '', r.location ?? '', r.summary ?? '', same.id);
      } else {
        const made = db.query('INSERT INTO roles (company, title, start, end, location, summary) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
          .get(r.company.trim(), (r.title ?? '').trim(), r.start ?? '', r.end ?? '', r.location ?? '', r.summary ?? '') as { id: number };
        byKey.set(r.key, made.id);
        existing.push({ id: made.id, company: r.company, title: r.title ?? '', start: '', end: '', location: '', summary: '' });
      }
    }
    const confirmed = new Set((db.query("SELECT text FROM facts WHERE status = 'confirmed'").all() as { text: string }[]).map((f) => norm(f.text)));
    const gone = new Set(deletedFacts());
    let n = 0;
    for (const f of x.facts ?? []) {
      const text = (f.text ?? '').trim();
      if (!text || confirmed.has(norm(text)) || gone.has(norm(text))) continue;
      const kind = (KINDS as readonly string[]).includes(f.kind) ? f.kind : 'other';
      // A fuller version of a fact the bank already has takes its place; the person's own wording is left alone.
      const old = /^fact:\d+$/.test(f.replaces ?? '') ? (db.query('SELECT id, status, skills, evidence FROM facts WHERE id = ?').get(Number(f.replaces!.slice(5))) as { id: number; status: string; skills: string; evidence: string } | null) : null;
      if (old) {
        if (old.status !== 'confirmed') {
          const skills = [...new Set([...old.skills.split(',').map((x) => x.trim()), ...(f.skills ?? [])].filter(Boolean))].join(', ');
          const evidence = [...new Set([old.evidence.trim(), (f.evidence ?? '').trim()].filter(Boolean))].join(' · ').slice(0, 1200);
          db.query("UPDATE facts SET text = ?, detail = CASE WHEN ? != '' THEN ? ELSE detail END, metric = CASE WHEN ? != '' THEN ? ELSE metric END, skills = ?, evidence = ? WHERE id = ?")
            .run(text, (f.detail ?? '').trim(), (f.detail ?? '').trim(), (f.metric ?? '').trim(), (f.metric ?? '').trim(), skills, evidence, old.id);
          n++;
        }
        continue;
      }
      db.query('INSERT INTO facts (role_id, kind, text, detail, metric, skills, evidence, source_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(byKey.get(f.roleKey) ?? null, kind, text, (f.detail ?? '').trim(), (f.metric ?? '').trim(), (f.skills ?? []).join(', '), (f.evidence ?? '').trim(), sourceId, 'proposed', now);
      n++;
    }
    return n;
  })();
}
