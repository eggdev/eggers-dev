// For the unit tests only (`bun test lib`): an empty bank in the scratch database, and an invented person to
// fill it with. Under `bun test` the database is a new file in the system's temporary folder (lib/paths.ts).
// This file refuses to do anything if it is ever anywhere else, so a test cannot touch the person's real data.
// Every name, employer and number here is made up.
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { DB_FILE, DATA_DIR } from './paths.ts';

if (process.env.NODE_ENV !== 'test' || !realpathSync(DATA_DIR).startsWith(realpathSync(tmpdir())) || resolve(DB_FILE).includes('.data')) {
  throw new Error(`lib/scratch.ts is for tests on a scratch database, and the database is ${DB_FILE}. Nothing was changed.`);
}

const { db } = await import('./db.ts');
await import('./person.ts'); await import('./talk.ts'); await import('./direction.ts'); await import('./raised.ts'); await import('./skills.ts'); await import('./linkedin.ts');

// Empties every table a test writes to.
export function reset(): void {
  for (const t of ['facts', 'roles', 'sources', 'jobs', 'answered', 'deleted_facts', 'raised_questions', 'skills', 'linkedin_positions', 'talk']) db.run(`DELETE FROM ${t}`);
  db.run('UPDATE skills_review SET reviewed_at = 0 WHERE id = 1');
  db.run("UPDATE profile SET gaps = '', body = '' WHERE id = 1");
  db.run("UPDATE direction SET body = '' WHERE id = 1");
  db.run("UPDATE person SET name = 'Avery Lindqvist', location = 'Duluth, MN', email = 'avery@lindqvist.example', phone = '2185550142', website = '', github = '', linkedin = '' WHERE id = 1");
}

type Role = { id: number; company: string; title: string; start?: string; end?: string; location?: string; standing?: string; part_of?: number | null; note?: string; label?: string };
export function role(r: Role): void {
  db.query('INSERT INTO roles (id, company, title, start, end, location, standing, part_of, note, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.company, r.title, r.start ?? '', r.end ?? '', r.location ?? '', r.standing ?? 'employer', r.part_of ?? null, r.note ?? '', r.label ?? '');
}
export function fact(roleId: number | null, text: string, metric = '', skills = ''): number {
  return (db.query("INSERT INTO facts (role_id, kind, text, metric, skills, created_at) VALUES (?, 'accomplishment', ?, ?, ?, 1) RETURNING id").get(roleId, text, metric, skills) as { id: number }).id;
}

// The invented person's three jobs, newest first, with a few measured results and skills.
export function seed(): void {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', location: 'Remote' });
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02', location: 'Duluth, MN' });
  role({ id: 3, company: 'Tessellate Freight', title: 'Support Lead', start: '2010-05', end: '2012-08' });
  fact(1, 'Built the dispatch console that schedulers use every day.', '640 users across 12 depots', 'TypeScript, PostgreSQL');
  fact(1, 'Cut the nightly billing run.', 'from 6 hours to 40 minutes', 'Go, PostgreSQL');
  fact(1, 'Wrote the test suite for the console.', '212 tests', 'TypeScript');
  fact(2, 'Rebuilt the quoting API.', 'p95 latency 900 ms to 210 ms', 'Go, Kafka');
  fact(2, 'Ran weekly code review sessions.', '', 'code review, mentoring');
  fact(3, 'Led the support desk.', 'team of 6 people', '');
}
export { db };
