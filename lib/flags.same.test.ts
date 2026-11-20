// `bun test lib`: rule 7 adds where each flag belongs (`at`) and the checks of links, and changes no flag a resume has
// today. The code at 387b909 (the last commit before rule 7) and the code now each take the flags of the same invented
// resumes, on the same invented record, in a process of their own. For a resume with no links (every resume stored
// before them) the flags are the same, kind for kind, severity, text and items, in the same order. Where that commit
// is not in this clone (a shallow checkout), the test is skipped and says why.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BEFORE = '387b909';
const repo = resolve(import.meta.dir, '..');
const dir = mkdtempSync(join(tmpdir(), 'egg-flags-same-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CHILD = String.raw`
const root = process.env.EGG_ROOT;
const { db, seed, role } = await import(root + '/lib/scratch.ts');
const { flags, flagContext } = await import(root + '/lib/checks.ts');
seed();
role({ id: 4, company: 'Globex', title: 'Engineer', start: '2022-01' });
// The project's first part is "situation" in the code before CARL and "context" since (lib/db.ts).
const part = db.query('PRAGMA table_info(projects)').all().some((c) => c.name === 'context') ? 'context' : 'situation';
db.run("INSERT INTO projects (role_id, title, " + part + ", created_at) VALUES (1, 'Console', 'It served 900 drivers and 640 users.', 1)");
const RESUMES = [
  '# Avery Lindqvist\nline\n\n## Summary\nAvery is an engineer with 14 years in logistics. She built a dispatch console for 640 users across 12 depots. It runs every day. It is fast.\n\n## Experience\n### VP of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console.\n- Cut a run for [number] drivers.\n- Served 900 drivers.\n\n### Engineer, Globex\nJan 2022 – Present\n- Build the routing service.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n\n### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n- Led the support desk.\n- Answered tickets.\n\n## Awards\nWon a prize, 2018 – 2019\n\n## Skills\nGo, synergy',
  '# Avery Lindqvist\nline\n\n## Summary\nEngineer with 14 years building logistics software in Go.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console that 640 users across 12 depots open every day.\n- Cut the nightly billing run from 6 hours to 40 minutes.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API in Go.\n\n## Skills\nGo',
  '# A\n\n## Summary\nEngineer.\n\n## Projects\n### Console\n- Made it.',
];
const ctx = flagContext();
const out = RESUMES.map((r) => flags(r, 2, {}, Date.UTC(2026, 10, 18), ctx).map((f) => [f.kind, f.severity, f.text, f.items ?? null]));
console.log('FLAGS' + JSON.stringify(out));
`;

function run(root: string, db: string): unknown[] {
  const p = Bun.spawnSync(['bun', '-e', CHILD], { cwd: repo, env: { ...process.env, EGG_ROOT: root, DB: db, NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString(), at = out.lastIndexOf('FLAGS');
  if (p.exitCode !== 0 || at < 0) throw new Error(`${root}: ${p.stderr.toString().slice(-1500)}`);
  return JSON.parse(out.slice(at + 5).trim());
}

const HAS_BEFORE = Bun.spawnSync(['git', 'cat-file', '-e', `${BEFORE}^{commit}`], { cwd: repo }).exitCode === 0;
if (!HAS_BEFORE) console.log(`flags.same: skipped, because commit ${BEFORE} is not in this clone (a shallow checkout).`);

test.skipIf(!HAS_BEFORE)(`a resume with no links has the flags it had at ${BEFORE}: kind, severity, text and items, in order`, () => {
  const old = join(dir, 'old');
  const tar = Bun.spawnSync(['sh', '-c', `mkdir -p "${old}" && git archive ${BEFORE} lib | tar -x -C "${old}"`], { cwd: repo });
  expect(tar.exitCode).toBe(0);
  symlinkSync(join(repo, 'node_modules'), join(old, 'node_modules'));
  const before = run(old, join(dir, 'before.db')) as unknown[][], now = run(repo, join(dir, 'now.db')) as unknown[][];
  expect(now).toEqual(before);
  // The resumes hold most kinds, so the comparison is worth something.
  expect(new Set(before.flat().map((f) => (f as string[])[0])).size).toBeGreaterThan(10);
}, 120_000);
