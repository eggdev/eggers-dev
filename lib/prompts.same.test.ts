// `bun test lib`: with nothing of the record's new parts set (no project of a role filled or filed, no fact detail, no
// kept line of "How you work"), every prompt is byte for byte what it was before projects reached the writers (commit
// a32e6ce). The code at that commit and the code now each run in a process of their own, on the same invented record,
// with the same stand-in model (fakeAsk), and every prompt they send is compared: the first reading, the resume's
// writer, the council's readers and reviser, the skim and its fix, the message drafts, and the council's review of a
// written resume and of one the person edited. Where the commit is not in this clone
// (a shallow checkout), the test is skipped and says why.
// Today's code runs with EGG_LINKS=off (lib/links.ts), and is compared with two commits: a32e6ce, as above, and 387b909,
// the last commit before the links of rule 7. With links off every prompt is byte for byte what it was at either: so
// EGG_LINKS=off is a way back that needs no deploy of old code. lib/prompts.links.test.ts compares links on with off.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const COMMITS = ['a32e6ce', '387b909'];
const repo = resolve(import.meta.dir, '..');
const dir = mkdtempSync(join(tmpdir(), 'egg-prompts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// What each process runs: the invented person, a stage 2 shaped record with nothing of stage 3 set, and every model call.
const CHILD = String.raw`
const root = process.env.EGG_ROOT;
const { db, seed } = await import(root + '/lib/scratch.ts');
const { assess, compose, review } = await import(root + '/lib/jobs.ts');
const { fakeAsk } = await import(root + '/lib/llm.ts');
const { draft } = await import(root + '/lib/outreach.ts');
seed();
// A project of a role with a name only and no fact, and a suggestion not decided: neither reaches a writer.
db.run("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Planned work', 1)");
db.run("INSERT INTO project_proposals (role_id, title, status, created_at) VALUES (1, 'A suggestion', 'open', 1)");
const POSTING = 'Staff Engineer at Nimbus Yard. You will build Go services on Kafka. Our first platform engineer: scale to millions of events.';
const REQS = [{ text: 'Go services in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API in Go.', roles: ['role:2'], best: 'fact:4', bestText: 'Rebuilt the quoting API.', weight: 0.9 }];
const RESUME = '# Avery Lindqvist\nline\n\n## Summary\nEngineer with 14 years building logistics software in Go.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console that 640 users across 12 depots open every day.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API in Go.\n\n## Skills\nGo\n';
const prompts = [];
fakeAsk((c) => {
  prompts.push(c.prompt);
  const p = c.prompt;
  if (p.startsWith('You are measuring one job posting against one person') && p.includes('so they can see where they stand'))
    return { title: 'Staff Engineer', company: 'Nimbus Yard', place: '', verdict: 'A fair fit.', requirements: REQS, strengths: ['Go'], risks: [], gaps: [], knockouts: [], checks: [], terms: ['Go'] };
  if (p.startsWith('You are measuring one job posting')) return { resume: RESUME, changes: [], questions: [] };
  if (p.startsWith('You are a recruiter with six seconds')) return { conclusion: 'A lead.', misleading: '', questions: [], top: [{ requirement: '', answered: false, note: 'Not at the top.' }] };
  if (p.startsWith('You are fixing the top')) return { resume: RESUME, changes: [] };
  if (p.startsWith('You are revising')) return { resume: RESUME, changes: [], questions: [] };
  if (p.startsWith('One person is applying')) return { doors: [{ to: 'The hiring manager', find: 'Search.', why: 'They run it.', message: 'I built a dispatch console that 640 users open. Avery' }] };
  return { score: 9, note: 'Clear.', problems: [] };
});
process.env.EGG_COUNCIL = 'on'; delete process.env.EGG_SKIM;
await assess(POSTING);
await compose(POSTING, 2, ['Go'], REQS);
const job = db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, contact) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, 1, '') RETURNING *").get(POSTING, JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], requirements: REQS }));
await draft(job, '.');
// The council on a resume already written, and on one the person edited (the readers only score it).
const ANALYSIS = JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], risks: [], changes: [], gaps: [], requirements: REQS });
const written = db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, edited, outcome) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, 1, 0, '') RETURNING *").get(POSTING, ANALYSIS, RESUME);
await review(written, false);
const edited = db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, edited, outcome) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, 1, 1, '') RETURNING *").get(POSTING, ANALYSIS, RESUME.replace('Engineer with 14 years', 'Engineer, in my own words, with 14 years'));
await review(edited, false);
console.log('PROMPTS' + JSON.stringify(prompts));
`;

function run(root: string, db: string): string[] {
  const p = Bun.spawnSync(['bun', '-e', CHILD], { cwd: repo, env: { ...process.env, EGG_ROOT: root, DB: db, NODE_ENV: 'test', EGG_COUNCIL: 'on', EGG_LINKS: 'off', EGG_CARL: 'off' }, stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString(), at = out.lastIndexOf('PROMPTS');
  if (p.exitCode !== 0 || at < 0) throw new Error(`${root}: ${p.stderr.toString().slice(-1500)}`);
  return JSON.parse(out.slice(at + 7).trim());
}

// Today's prompts, made once and compared with each commit.
let today: string[] | undefined;
for (const BEFORE of COMMITS) {
  // The commit to compare with is not in a shallow clone (CI checks out one commit): then the test is skipped, and says why.
  const HAS_BEFORE = Bun.spawnSync(['git', 'cat-file', '-e', `${BEFORE}^{commit}`], { cwd: repo }).exitCode === 0;
  if (!HAS_BEFORE) console.log(`prompts.same: skipped, because commit ${BEFORE} is not in this clone (a shallow checkout).`);

  test.skipIf(!HAS_BEFORE)(`with nothing of the new parts set and links off, every prompt is byte for byte what it was at ${BEFORE}`, () => {
    const old = join(dir, `old-${BEFORE}`);
    const tar = Bun.spawnSync(['sh', '-c', `mkdir -p "${old}" && git archive ${BEFORE} lib | tar -x -C "${old}"`], { cwd: repo });
    expect(tar.exitCode).toBe(0);
    symlinkSync(join(repo, 'node_modules'), join(old, 'node_modules'));
    const before = run(old, join(dir, `before-${BEFORE}.db`)), now = (today ??= run(repo, join(dir, 'now.db')));
    // The same calls, in the same order, each the same text.
    expect(now.length).toBe(before.length);
    console.log(`prompts.same: ${before.length} prompts compared.`);
    expect(before.length).toBeGreaterThan(5);
    for (let i = 0; i < before.length; i++) {
      if (now[i] !== before[i]) { let at = 0; while (now[i][at] === before[i][at]) at++; console.log(`prompt ${i} differs at ${at}:\nBEFORE …${JSON.stringify(before[i].slice(Math.max(0, at - 200), at + 200))}\nNOW    …${JSON.stringify(now[i].slice(Math.max(0, at - 200), at + 200))}`); }
      expect([i, now[i] === before[i]]).toEqual([i, true]);
    }
  }, 120_000);
}
