// `bun test lib`: what rule 7's links change in the prompts, and nothing else. Today's code runs twice on the same
// invented record with the same stand-in model (fakeAsk), once with links on and once with EGG_LINKS=off, each in a
// process of its own. The same calls are made in the same order. The first reading, the council's readers, the
// six-second glance and the message drafts are byte for byte the same. The writer, the reviser and the skim's fix
// differ only by the rule on keys (LINKS), the keys on the resume's lines, and the lines that say what the check of links
// found. lib/prompts.same.test.ts holds links off against the commits before them.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripLinks } from './links.ts';
import { LINKS } from './writing.ts';

const repo = resolve(import.meta.dir, '..');
const dir = mkdtempSync(join(tmpdir(), 'egg-prompts-links-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// With links on, the stand-in writes keys, as the writer is told to. One line cites a fact that does not hold its
// numbers, so the fix is sent a link finding (the glance says the top misses its requirement, so the fix runs either way).
const CHILD = String.raw`
const root = process.env.EGG_ROOT;
const { db, seed } = await import(root + '/lib/scratch.ts');
const { assess, compose, review } = await import(root + '/lib/jobs.ts');
const { fakeAsk } = await import(root + '/lib/llm.ts');
const { draft } = await import(root + '/lib/outreach.ts');
seed();
const POSTING = 'Staff Engineer at Nimbus Yard. You will build Go services on Kafka. Our first platform engineer: scale to millions of events.';
const REQS = [{ text: 'Go services in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API in Go.', roles: ['role:2'], best: 'fact:4', bestText: 'Rebuilt the quoting API.', weight: 0.9 }];
const RESUME = '# Avery Lindqvist\nline\n\n## Summary\nEngineer with 14 years building logistics software in Go. {fact:1}\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console that 640 users across 12 depots open every day. {fact:2}\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API in Go. {fact:4}\n\n## Skills\nGo\n';
const ON = process.env.EGG_LINKS !== 'off', written = ON ? RESUME : RESUME.replace(/ \{fact:\d\}/g, '');
const prompts = [];
fakeAsk((c) => {
  prompts.push(c.prompt);
  const p = c.prompt;
  if (p.startsWith('You are measuring one job posting against one person') && p.includes('so they can see where they stand'))
    return { title: 'Staff Engineer', company: 'Nimbus Yard', place: '', verdict: 'A fair fit.', requirements: REQS, strengths: ['Go'], risks: [], gaps: [], knockouts: [], checks: [], terms: ['Go'] };
  if (p.startsWith('You are measuring one job posting')) return { resume: written, changes: [], questions: [] };
  if (p.startsWith('You are a recruiter with six seconds')) return { conclusion: 'A lead.', misleading: '', questions: [], top: [{ requirement: '', answered: false, note: 'Not at the top.' }] };
  if (p.startsWith('You are fixing the top')) return { resume: written, changes: [] };
  if (p.startsWith('You are revising')) return { resume: written, changes: [], questions: [] };
  if (p.startsWith('One person is applying')) return { doors: [{ to: 'The hiring manager', find: 'Search.', why: 'They run it.', message: 'I built a dispatch console that 640 users open. Avery' }] };
  return { score: 6, note: 'Fair.', problems: [] };
});
process.env.EGG_COUNCIL = 'on'; delete process.env.EGG_SKIM;
await assess(POSTING);
await compose(POSTING, 2, ['Go'], REQS);
const job = db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, contact) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, 1, '') RETURNING *").get(POSTING, JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], requirements: REQS }));
await draft(job, '.');
const ANALYSIS = JSON.stringify({ verdict: 'A fair fit.', strengths: ['Go'], risks: [], changes: [], gaps: [], requirements: REQS });
const plain = RESUME.replace(/ \{fact:\d\}/g, '');
const written2 = db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, edited, outcome) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, 1, 0, '') RETURNING *").get(POSTING, ANALYSIS, plain);
await review(written2, false);
console.log('PROMPTS' + JSON.stringify(prompts));
`;

function run(links: 'on' | 'off'): string[] {
  const p = Bun.spawnSync(['bun', '-e', CHILD], { cwd: repo, env: { ...process.env, EGG_ROOT: repo, DB: join(dir, `${links}.db`), NODE_ENV: 'test', EGG_COUNCIL: 'on', EGG_LINKS: links }, stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString(), at = out.lastIndexOf('PROMPTS');
  if (p.exitCode !== 0 || at < 0) throw new Error(`${links}: ${p.stderr.toString().slice(-1500)}`);
  return JSON.parse(out.slice(at + 7).trim());
}

// What a link finding says (lib/links.ts, checkLinks), as a line of the fix's "What to fix".
const LINK_FINDING = /^- (?:The summary|“.*”) (?:cites |names no fact of your record|has no fact left|uses .* which (?:is|are) in none of the facts it cites)/;

test('links on and off make the same calls; only the writer, the reviser and the fix differ, by the rule, the keys and the link findings', () => {
  const on = run('on'), off = run('off');
  expect(on.length).toBe(off.length);
  console.log(`prompts.links: ${on.length} prompts compared.`);
  const kind = (p: string) => (p.startsWith('You are measuring one job posting') ? (p.includes('so they can see where they stand') ? 'assess' : 'write') : p.startsWith('You are revising') ? 'revise' : p.startsWith('You are fixing the top') ? 'fix' : p.startsWith('You are a recruiter with six seconds') ? 'glance' : p.startsWith('One person is applying') ? 'draft' : 'read');
  const seen = new Set<string>(), found: string[] = [];
  for (let i = 0; i < off.length; i++) {
    const k = kind(off[i]);
    seen.add(k);
    expect([i, kind(on[i])]).toEqual([i, k]);
    if (!['write', 'revise', 'fix'].includes(k)) { expect([i, k, on[i] === off[i]]).toEqual([i, k, true]); continue; }
    expect([i, k, on[i].includes(LINKS), off[i].includes(LINKS)]).toEqual([i, k, true, false]);
    const lines = on[i].split(`\n\n${LINKS}`).join('').split(`${LINKS}\n\n`).join('').split('\n');
    found.push(...lines.filter((l) => LINK_FINDING.test(l)));
    // The keys are taken out of the resume as the rewriter was shown it; the rest of the prompt is compared as it is.
    const keyless = lines.filter((l) => !LINK_FINDING.test(l)).join('\n').replace(/<resume>\n([\s\S]*?)\n<\/resume>/g, (_m, r: string) => `<resume>\n${stripLinks(r)}\n</resume>`);
    expect([i, k, keyless]).toEqual([i, k, off[i]]);
  }
  expect([...seen].sort()).toEqual(['assess', 'draft', 'fix', 'glance', 'read', 'revise', 'write']);
  // The fix was told what the check of links found: the console's line cites the billing run, which holds none of its numbers.
  expect(found.some((l) => l.startsWith('- “Build the dispatch console that 640 users across 12 depots open every day.” uses 640 and 12, which are in none of the facts it cites.'))).toBe(true);
}, 120_000);
