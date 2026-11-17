// `bun test lib`: the migrations. A database is made with the schema and rows from before the resume rules,
// then opened with today's code in a separate process, twice. The old rows must be unchanged, the new
// columns and tables must be there, and an analysis stored before "implied" requirements, flags and the skim
// existed must still read. The person and their jobs are invented.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OLD_ANALYSIS, OLD_FACT_COLUMNS, OLD_RESUME, oldDatabase, oldTreeDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-migrate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, 'egg.db');

// Opens the database with today's code, as the server and the worker do, and reports what it finds.
const lib = import.meta.dir;
const CHILD = `
const { db, bankSignature } = await import('${lib}/db.ts');
const jobs = await import('${lib}/jobs.ts');
const { syncQuestions } = await import('${lib}/checks.ts');
const { openQuestions } = await import('${lib}/talk.ts');
const { openRaised } = await import('${lib}/raised.ts');
const { positions, storePositions } = await import('${lib}/linkedin.ts');
const { allSkills } = await import('${lib}/skills.ts');
const cols = (t) => db.query('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
if (positions().length === 0) { const s = db.query("SELECT id, body FROM sources WHERE body LIKE '%## Positions.csv%'").get(); storePositions(s.body, s.id, Date.now()); }
syncQuestions(Date.now());
jobs.reflag(1);
const job = db.query('SELECT * FROM jobs WHERE id = 1').get(), a = JSON.parse(job.analysis);
console.log(JSON.stringify({ sig: bankSignature(), roleCols: cols('roles'), tables: db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name),
  roles: db.query('SELECT id, company, title, start, end, location, summary, standing, reach, part_of FROM roles ORDER BY id').all(), extra: db.query('SELECT note, label FROM roles ORDER BY id').all(),
  facts: db.query('SELECT ${OLD_FACT_COLUMNS} FROM facts ORDER BY id').all(), sources: db.query('SELECT * FROM sources').all(), job: { resume: job.resume, fit: job.fit, edited: job.edited, bank_sig: job.bank_sig },
  analysis: a, top: jobs.topRequirements(a.requirements).map((r) => r.text), fit: jobs.fitOf(a.requirements), positions: positions(), skills: allSkills().map((s) => s.name), open: openQuestions().map((q) => q.text), raised: openRaised().map((q) => q.text) }));
`;
function open(child = CHILD, at = file) {
  const run = Bun.spawnSync(['bun', '-e', child], { env: { ...process.env, DB: at, NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString().slice(-1500));
  return JSON.parse(run.stdout.toString().trim().split('\n').pop()!);
}

test('an old database opens with the new code, twice, with its rows intact and its analyses readable', () => {
  const before = oldDatabase(file);
  const first = open(), second = open();
  for (const got of [first, second]) {
    // Old rows, column for column.
    expect(got.roles).toEqual(before.rows.roles);
    expect(got.facts).toEqual(before.rows.facts);
    expect(got.sources).toEqual(before.rows.sources);
    // New columns are empty, new tables exist.
    expect(got.roleCols).toEqual(expect.arrayContaining(['note', 'label']));
    expect(got.extra).toEqual([{ note: '', label: '' }, { note: '', label: '' }, { note: '', label: '' }]);
    expect(got.tables).toEqual(expect.arrayContaining(['raised_questions', 'skills', 'skills_review', 'linkedin_positions']));
    // The bank's signature is what it was, so no resume is queued to be written again only because of the migration.
    expect(got.sig).toBe(before.sig);
    // The stored resume and the person's edit of it are untouched.
    expect(got.job).toEqual({ resume: OLD_RESUME, fit: 68, edited: 1, bank_sig: 'oldsig' });
    // The old analysis still reads: its requirements (must and nice only), terms and review, with flags added beside them.
    expect(got.analysis.requirements).toEqual(OLD_ANALYSIS.requirements);
    expect(got.analysis.review).toEqual(OLD_ANALYSIS.review);
    expect(got.analysis.verdict).toBe('A fair fit.');
    expect(got.top).toEqual(['Go in production']);
    expect(got.fit).toBe(68);
    expect(got.analysis.flags.map((f: { kind: string }) => f.kind)).toEqual(expect.arrayContaining(['headings', 'skills-other', 'skills-unconfirmed']));
    // The LinkedIn export read earlier now has its positions as rows, and the skills list is filled from the bank.
    expect(got.positions).toEqual([{ company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03', end: '', location: '' }]);
    expect(got.skills).toEqual(['Go', 'TypeScript']);
    // A question answered before stays answered; the difference with LinkedIn is asked, apart from Talk's questions.
    expect(got.open).not.toContain('What did the console replace?');
    expect(got.open).toContain('Who used the quoting API?');
    expect(got.raised.some((q: string) => q.includes('Senior Engineer at Quillfeather Labs') && q.includes('LinkedIn does not list it'))).toBe(true);
  }
  expect(second.analysis).toEqual(first.analysis);
}, 60_000);

// The record as a tree. The first start of the new code finds the project-like rows of `roles` and gives each one
// project that points at it (`via_role`), and changes nothing else: no role, no fact, no signature, no resume, and no
// work is queued. Opened twice, it makes no second project.
const treeFile = join(dir, 'tree.db');
const TREE_CHILD = `
const { db, bankSignature } = await import('${lib}/db.ts');
await import('${lib}/projects.ts');
const { dueIn } = await import('${lib}/activity.ts');
const { readTree } = await import('${lib}/record.ts');
const t = readTree();
console.log(JSON.stringify({ sig: bankSignature(), due: dueIn(Date.now(), bankSignature),
  roles: db.query('SELECT id, company, title, start, end, location, summary, standing, reach, part_of FROM roles ORDER BY id').all(),
  facts: db.query('SELECT ${OLD_FACT_COLUMNS} FROM facts ORDER BY id').all(),
  jobs: db.query('SELECT id, resume, resume_status, bank_sig, edited FROM jobs ORDER BY id').all(),
  profile: db.query('SELECT status FROM profile').get(), activity: db.query('SELECT count(*) AS n FROM activity').get(),
  projects: db.query('SELECT id, via_role, role_id, title FROM projects ORDER BY id').all(),
  tree: { roles: t.roles.map((r) => r.ref), projects: t.projects.map((p) => [p.ref, p.place, p.roleId, p.title]), facts: t.facts.map((f) => [f.ref, f.roleId, f.projectId]) } }));
`;

test('the first start of the tree gives each project-like row one project, and changes no role, fact, signature or resume', () => {
  const before = oldTreeDatabase(treeFile);
  const first = open(TREE_CHILD, treeFile), second = open(TREE_CHILD, treeFile);
  for (const got of [first, second]) {
    expect(got.roles).toEqual(before.rows.roles);
    expect(got.facts).toEqual(before.rows.facts);
    expect(got.jobs).toEqual(before.rows.jobs);
    expect(got.sig).toBe(before.sig);
    // Nothing is queued: no resume waits to be written again, and the profile is as it was.
    expect(got.due).toBe(0);
    expect(got.jobs.map((j: { resume_status: string }) => j.resume_status)).toEqual(['done']);
    expect(got.profile).toEqual({ status: 'none' });
    expect(got.activity).toEqual({ n: 0 });
    // One carried project for each of the three rows, and no second one on the second start.
    expect(got.projects).toEqual([{ id: 1, via_role: 3, role_id: null, title: '' }, { id: 2, via_role: 4, role_id: null, title: '' }, { id: 3, via_role: 5, role_id: null, title: '' }]);
  }
  // The tree: two roles; the project group under its employer, the side project, and the repository nobody placed,
  // which is shown as not placed and never put anywhere by code.
  expect(first.tree.roles).toEqual(['R-01', 'R-02']);
  expect(first.tree.projects).toEqual([['P-001', 'role', '1', 'harborlight/dispatch'], ['P-002', 'side', '', 'lantern-notes'], ['P-003', 'unplaced', '', 'avery/sketchbook']]);
  expect(first.tree.facts).toEqual([['F-0001', '1', ''], ['F-0002', '2', ''], ['F-0003', '1', '1'], ['F-0004', '', '2'], ['F-0005', '', '3']]);
  expect(second.tree).toEqual(first.tree);
}, 60_000);
