// The profile: one document written from the whole bank, saying who the person is, how they
// work, what they have delivered and why to hire them. It is the base a tailored resume starts from.
// Nothing in it may go beyond the bank; what the bank is thin on is returned as questions instead.
import { SIGNAL, WRITING } from './writing.ts';
import { ASKED, db, type RoleRow } from './db.ts';
import { directionForMaterials, targets } from './direction.ts';
import { ask } from './llm.ts';

// The kinds of role the person is looking for. Each gets its own "why hire me" section.
// The kinds of role argued for: the tracks in the person's direction notes, else three defaults.
export const TARGETS = { get list() { return targets(); } };

const SCHEMA = { type: 'object', required: ['markdown', 'gaps'], additionalProperties: false,
  properties: { markdown: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } } } };

type FactRow = { role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string; evidence: string };

function bank() {
  const roles = db.query("SELECT * FROM roles ORDER BY CASE WHEN end = '' AND start != '' THEN 1 ELSE 0 END DESC, end DESC, start DESC").all() as RoleRow[];
  const facts = db.query('SELECT role_id, kind, text, detail, metric, skills, evidence FROM facts ORDER BY id').all() as FactRow[];
  const of = (id: number | null) => facts.filter((f) => f.role_id === id).map(({ role_id: _r, ...f }) => f);
  return { count: facts.length,
    // A project filed under an employer is nested in it, so it is written up as work done in that job.
    roles: roles.filter((r) => r.part_of === null || !roles.some((p) => p.id === r.part_of)).map((r) => ({ company: r.company, title: r.title, start: r.start, end: r.end || 'present', location: r.location, summary: r.summary, facts: of(r.id),
      projects: roles.filter((c) => c.part_of === r.id).map((c) => ({ name: c.company, start: c.start, end: c.end || 'present', facts: of(c.id) })).filter((c) => c.facts.length > 0) })).filter((r) => r.facts.length > 0 || r.projects.length > 0),
    general: [...of(null), ...facts.filter((f) => f.role_id !== null && !roles.some((r) => r.id === f.role_id)).map(({ role_id: _r, ...f }) => f)] };
}

export const factCount = () => (db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n;

export async function write(): Promise<{ markdown: string; gaps: string[] }> {
  const b = bank();
  if (b.count === 0) throw new Error('Your record is empty. Tell a story first.');
  return ask({ cwd: process.cwd(), schema: SCHEMA, timeoutMs: 20 * 60_000, model: process.env.EGG_PROFILE_MODEL ?? process.env.EGG_MODEL ?? 'opus',
    prompt: `You are writing one person's professional profile from their knowledge bank. It is the base document their resumes and cover letters are tailored from, and they will also read it to see themselves described well. Write it in the first person, in plain, confident, specific language.

The bank is everything you know. Every statement must be supported by a fact in it. Never invent, round up or infer a number, a title, a date, a technology or an outcome. Prefer the person's concrete stories to general claims: a claim about how they work must name the work that shows it. Do not use filler praise (passionate, results-driven, proven track record, seasoned).

${WRITING}

${SIGNAL}

Write Markdown with exactly these sections, in this order:

# Professional profile
## Summary
One paragraph: who this person is as an engineer, the through-line of their career, and the kind of problems they are best at.
## How I work
Three to six short paragraphs or bullets on patterns that recur across roles (how they lead, decide, build, and work with customers or teammates), each tied to named work.
## What I have delivered
By role, newest first, as "### Title, Company (dates)". A role's "projects" are work done in that job: fold them into that role, never list them separately. Under each, the strongest stories as bullets: what the situation was, what they did, what came of it. Keep numbers exactly as the bank has them.
${TARGETS.list.map((t) => `## Why hire me as a ${t.toLowerCase()}\nThree to five bullets, each a reason grounded in specific evidence from the bank. If the bank has little for this kind of role, say what there is and keep it short.`).join('\n')}
## Skills
Grouped (languages, frameworks, infrastructure, practices), each group listing only skills the bank shows in use, most used first.
## Timeline
One line per role: dates, title, company, location when known.

${directionForMaterials() ? `The person's own notes on their direction follow. Treat them as their instructions on emphasis, order and tone: lead with what they say to lead with, include what they ask to include (such as earlier non-engineering work they value) at the weight they give it, and use their positioning line if they give one. They do not add facts: every statement still needs the bank.\n<direction>\n${directionForMaterials()}\n</direction>\n\n` : ''}Then, separately from the document, list in "gaps" up to twelve specific questions whose answers would most strengthen this profile for these kinds of role: a story with no outcome, a role with few facts, leadership or customer work that is hinted at but not described, a number that is implied but not given. Each is one question the person can answer from memory, naming the role or project it is about.

${ASKED()}
The bank, as JSON:
${JSON.stringify({ roles: b.roles, general: b.general })}` });
}
