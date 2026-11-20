// `bun test lib`: what CARL changes in the prompts, and nothing else. Today's code runs twice on the same invented record
// (a project of a role with all four parts, a fact filed in it, facts that name skills) with the same stand-in model
// (fakeAsk), once as it is and once with EGG_CARL=off, each in a process of its own. The same calls are made in the same
// order. The message drafts and the six-second glance are byte for byte the same. Every other prompt differs only by:
// the bullet rules (BULLETS), the project rules (CONTEXT), the wording rules' two sentences on a CARL bullet (WRITING,
// and the council's Editor), the length limits, the form of a bullet named in the writer's
// item 4, the project's parts in the bank ("parts": { context, action, result, learning } in place of "context":
// { situation, what_i_did, result }), the Technologies line under each entry of the resume shown, and a word count that counts that line.
// lib/prompts.same.test.ts holds EGG_CARL=off against the commits before.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '..');
const dir = mkdtempSync(join(tmpdir(), 'egg-prompts-carl-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CHILD = String.raw`
const root = process.env.EGG_ROOT;
const { db, seed } = await import(root + '/lib/scratch.ts');
const { assess, bank, compose, limits, review } = await import(root + '/lib/jobs.ts');
const { fakeAsk } = await import(root + '/lib/llm.ts');
const { draft } = await import(root + '/lib/outreach.ts');
const { carlText } = await import(root + '/lib/writing.ts');
seed();
const p = db.query("INSERT INTO projects (role_id, title, context, action, result, learning, created_at) VALUES (1, 'Dispatch console', 'Schedulers planned every depot on paper.', 'I wrote the scheduler.', 'One console for every depot.', 'I learned to ship in small steps.', 1) RETURNING id").get().id;
db.query('UPDATE facts SET project_id = ? WHERE id = 1').run(p);
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
  return { score: 6, note: 'Fair.', problems: [] };
});
process.env.EGG_COUNCIL = 'on'; delete process.env.EGG_SKIM;
await assess(POSTING);
await compose(POSTING, 2, ['Go'], REQS);
const job = db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, contact) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, 1, '') RETURNING *").get(POSTING, JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], requirements: REQS }));
await draft(job, '.');
const ANALYSIS = JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], risks: [], changes: [], gaps: [], requirements: REQS });
const written = db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, edited, outcome) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, 1, 0, '') RETURNING *").get(POSTING, ANALYSIS, RESUME);
await review(written, false);
console.log('PROMPTS' + JSON.stringify({ prompts, banks: [JSON.stringify(bank()), JSON.stringify(bank(true))], text: carlText(), limits: [limits(1), limits(2)] }));
`;

type Run = { prompts: string[]; banks: string[]; text: { BULLETS: string; CONTEXT: string; WRITING: string }; limits: string[] };
function run(carl: 'on' | 'off'): Run {
  const p = Bun.spawnSync(['bun', '-e', CHILD], { cwd: repo, env: { ...process.env, EGG_ROOT: repo, DB: join(dir, `${carl}.db`), NODE_ENV: 'test', EGG_COUNCIL: 'on', EGG_CARL: carl }, stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString(), at = out.lastIndexOf('PROMPTS');
  if (p.exitCode !== 0 || at < 0) throw new Error(`${carl}: ${p.stderr.toString().slice(-1500)}`);
  return JSON.parse(out.slice(at + 7).trim());
}

// What the council's Editor is told beside its brief with CARL on (lib/council.ts).
const EDITOR = ' A bullet\'s opening context clause, its action and its result are one statement, not two things. A short closing Learning clause that states what the person learned, and claims no benefit, is not a benefit clause.';
const FORM = { on: 'each in the form context, action, result, learning, with only the action always there.', off: 'each in the form action, what it was for, result.' };
const kind = (p: string) => (p.startsWith('You are measuring one job posting') ? (p.includes('so they can see where they stand') ? 'assess' : 'write') : p.startsWith('You are revising') ? 'revise' : p.startsWith('You are fixing the top') ? 'fix' : p.startsWith('You are a recruiter with six seconds') ? 'glance' : p.startsWith('One person is applying') ? 'draft' : 'read');

test('CARL on and off make the same calls; the prompts differ only by the CARL rules, limits, bank parts and Technologies lines', () => {
  const on = run('on'), off = run('off');
  expect(on.prompts.length).toBe(off.prompts.length);
  console.log(`prompts.carl: ${on.prompts.length} prompts compared.`);
  // The texts themselves differ, and the bank has the four parts with learning only with CARL on.
  expect(on.text.BULLETS).not.toBe(off.text.BULLETS);
  expect(on.text.CONTEXT).not.toBe(off.text.CONTEXT);
  expect(on.text.WRITING).not.toBe(off.text.WRITING);
  expect(on.prompts.some((p) => p.includes(EDITOR))).toBe(true);
  expect(on.limits.map((l) => /at most (\d+) words\. /.exec(l)?.[1])).toEqual(['30', '34']);
  expect(off.limits.map((l) => /at most (\d+) words\. /.exec(l)?.[1])).toEqual(['22', '28']);
  expect(on.banks[0]).toContain('"parts":{"context":"Schedulers planned every depot on paper.","action":"I wrote the scheduler.","result":"One console for every depot.","learning":"I learned to ship in small steps."}');
  expect(off.banks[0]).toContain('"context":{"situation":"Schedulers planned every depot on paper.","what_i_did":"I wrote the scheduler.","result":"One console for every depot."}');
  expect(off.banks[0]).not.toContain('I learned to ship');
  const seen = new Set<string>();
  let tech = 0;
  for (let i = 0; i < off.prompts.length; i++) {
    const k = kind(off.prompts[i]);
    seen.add(k);
    expect([i, kind(on.prompts[i])]).toEqual([i, k]);
    if (k === 'draft' || k === 'glance') { expect([i, k, on.prompts[i] === off.prompts[i]]).toEqual([i, k, true]); continue; }
    expect([i, k, off.prompts[i].includes('Technologies:'), off.prompts[i].includes(on.text.BULLETS)]).toEqual([i, k, false, false]);
    if (on.prompts[i].includes('\nTechnologies: ')) tech++;
    let x = on.prompts[i];
    for (const [a, b] of [[on.text.BULLETS, off.text.BULLETS], [on.text.CONTEXT, off.text.CONTEXT], [on.text.WRITING, off.text.WRITING], [EDITOR, ''], [on.limits[0], off.limits[0]], [on.limits[1], off.limits[1]], [FORM.on, FORM.off], [on.banks[0], off.banks[0]], [on.banks[1], off.banks[1]]]) x = x.split(a).join(b);
    x = x.replace(/\n\nTechnologies: [^\n]*/g, '');
    const words = (s: string) => s.replace(/It runs to about \d+ words/g, 'It runs to about N words');
    expect([i, k, words(x)]).toEqual([i, k, words(off.prompts[i])]);
  }
  expect([...seen].sort()).toEqual(['assess', 'draft', 'fix', 'glance', 'read', 'revise', 'write']);
  // The resume every reader, the reviser and the fix were shown carries the lines code wrote.
  expect(tech).toBeGreaterThan(3);
}, 120_000);
