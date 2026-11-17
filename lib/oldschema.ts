// For the unit tests only: a database as it was before the resume rules, with the tables and the columns the old
// code had, and a few rows of an invented person. A test opens it with today's code to prove the migrations
// keep old data whole (lib/migration.test.ts) and that the routes behave on such data (lib/routes.test.ts).
// This file imports nothing of the app, so making the database runs no migration.
import { Database } from 'bun:sqlite';

export const OLD_ANALYSIS = { verdict: 'A fair fit.', strengths: ['Go'], risks: [], changes: ['Led with Go.'], gaps: ['Who used the quoting API?'],
  requirements: [{ text: 'Go in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API.', roles: ['role:2'], weight: 0.9, basis: 'Quillfeather Labs, employer' }, { text: 'Kafka', need: 'nice', coverage: 'none', evidence: 'Nothing.', roles: [], weight: 0, basis: '' }],
  terms: { inResume: ['Go'], inBankOnly: [], missing: ['Kafka'] }, review: { score: 8, rounds: 1, passed: true, seats: [], changes: [], questions: ['What did the console replace?'] } };
export const OLD_RESUME = '# Avery Lindqvist\nDuluth, MN · avery@lindqvist.example · 218-555-0142\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console.\n\n## Projects\n### Lantern Notes\n- Made it.\n\n## Skills\nGo, Also: Kafka';

// The tables as they were, with the columns the old code had added by ALTER TABLE.
export function oldDatabase(file: string) {
  const d = new Database(file);
  d.run("CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)");
  d.run("CREATE TABLE roles (id INTEGER PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, start TEXT NOT NULL DEFAULT '', end TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', standing TEXT NOT NULL DEFAULT '', reach TEXT NOT NULL DEFAULT '', part_of INTEGER)");
  d.run("CREATE TABLE facts (id INTEGER PRIMARY KEY, role_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, metric TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '', source_id INTEGER, status TEXT NOT NULL DEFAULT 'proposed', created_at INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '')");
  d.run(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL DEFAULT '', posting TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued', note TEXT NOT NULL DEFAULT '', fit INTEGER NOT NULL DEFAULT -1, analysis TEXT NOT NULL DEFAULT '', resume TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
    resume_status TEXT NOT NULL DEFAULT '', resume_note TEXT NOT NULL DEFAULT '', terms_raw TEXT NOT NULL DEFAULT '[]', bank_sig TEXT NOT NULL DEFAULT '', outreach TEXT NOT NULL DEFAULT '', outreach_status TEXT NOT NULL DEFAULT '', outreach_note TEXT NOT NULL DEFAULT '',
    edited INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT '', outcome_note TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', ats TEXT NOT NULL DEFAULT '', pdf TEXT NOT NULL DEFAULT '', pages INTEGER NOT NULL DEFAULT 2,
    posted_at INTEGER NOT NULL DEFAULT 0, salary TEXT NOT NULL DEFAULT '', applied_at INTEGER NOT NULL DEFAULT 0)`);
  d.run('CREATE TABLE answered (question TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  d.run("INSERT INTO sources (kind, title, body, status, created_at) VALUES ('text', 'LinkedIn export', '## Positions.csv\nCompany Name,Title,Started On,Finished On\nHarborlight Systems,Director of Engineering,Mar 2021,\n', 'done', 1)");
  d.run("INSERT INTO roles (id, company, title, start, end, location, standing, reach) VALUES (1, 'Harborlight Systems', 'Director of Engineering', '2021-03', '', 'Remote', 'employer', 'live')");
  d.run("INSERT INTO roles (id, company, title, start, end, standing) VALUES (2, 'Quillfeather Labs', 'Senior Engineer', '2016-01', '2021-02', 'employer')");
  d.run("INSERT INTO roles (id, company, title, start, end, part_of) VALUES (3, 'harborlight/dispatch', '', '2021-06', '2022-01', 1)");
  d.run("INSERT INTO facts (id, role_id, kind, text, metric, skills, status, created_at, detail) VALUES (1, 1, 'accomplishment', 'Built the dispatch console.', '640 users', 'TypeScript, Go', 'confirmed', 1, 'The story.')");
  d.run("INSERT INTO facts (id, role_id, kind, text, skills, created_at) VALUES (2, 2, 'project', 'Rebuilt the quoting API.', 'Go', 1)");
  d.query("INSERT INTO jobs (id, posting, title, company, status, fit, analysis, resume, created_at, bank_sig, edited, outcome) VALUES (1, 'A posting about Go.', 'Staff Engineer', 'Nimbus Yard', 'done', 68, ?, ?, 1, 'oldsig', 1, '')").run(JSON.stringify(OLD_ANALYSIS), OLD_RESUME);
  d.run("INSERT INTO answered (question, at) VALUES ('What did the console replace?', 1)");
  // The bank's signature by the old rule: facts and roles only.
  const sig = new Bun.CryptoHasher('sha256').update(JSON.stringify([d.query('SELECT id, role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all(), d.query('SELECT id, company, title, start, end, standing, reach, part_of FROM roles ORDER BY id').all()])).digest('hex').slice(0, 24);
  const rows = { roles: d.query('SELECT * FROM roles ORDER BY id').all(), facts: d.query('SELECT * FROM facts ORDER BY id').all(), sources: d.query('SELECT * FROM sources').all() };
  d.close();
  return { sig, rows };
}
