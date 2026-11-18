// Reaching out: for one job, a few short messages the person can send to open a door, each by a
// different way in (someone they know there, the hiring manager, a recruiter, a former colleague
// who could introduce them). They are drafts to personalise: every claim comes from the bank, and
// anything the tool cannot know stands as a [bracketed] blank for the person to fill.
import { db, factDetails, filedInProjects, saidValue } from './db.ts';
import { ask } from './llm.ts';
import { NUMBER_TOKEN, quantities, redact, unsupported } from './numbers.ts';
import { versionNames } from './checks.ts';
import { person } from './person.ts';
import { keptLines } from './record.ts';
import { KEPT_LINES, LEARNED, NUMBER_MARK, WRITING } from './writing.ts';
import type { JobRow } from './jobs.ts';


export type Door = { to: string; find: string; why: string; message: string };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['doors'], properties: { doors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['to', 'find', 'why', 'message'],
  properties: { to: { type: 'string' }, find: { type: 'string' }, why: { type: 'string' }, message: { type: 'string' } } } } } };

// The projects of roles whose facts carry this application: those holding a fact the posting map names as the
// strongest evidence for a requirement. For each, its name, its background (the parts that are set), what the person
// says they learned, and its facts. A project with no background and nothing learned adds nothing, and is left out.
type Carrying = { name: string; situation?: string; what_i_did?: string; result?: string; learned?: string; facts: string[] };
function carrying(analysis: { requirements?: { best?: string }[] }): Carrying[] {
  const best = new Set((analysis.requirements ?? []).map((r) => /^fact:(\d+)$/.exec(r.best ?? '')).filter((m) => m !== null).map((m) => Number(m![1])));
  const filed = filedInProjects(), ids = [...new Set(filed.filter((f) => best.has(f.id)).map((f) => f.project_id))];
  if (ids.length === 0) return [];
  const rows = db.query(`SELECT id, title, situation, did, result, learned FROM projects WHERE id IN (${ids.join(',')}) ORDER BY id`).all() as { id: number; title: string; situation: string; did: string; result: string; learned: string }[];
  const facts = db.query(`SELECT id, text, detail, metric, baseline, team, own_part FROM facts WHERE id IN (${filed.map((f) => f.id).join(',')}) ORDER BY id`).all() as Record<string, string | number>[];
  return rows.map((p) => {
    const mine = facts.filter((f) => filed.some((x) => x.id === f.id && x.project_id === p.id));
    // The background and what was learned go with each number no fact of the project holds strictly taken out (lib/numbers.ts).
    const held = quantities(mine.map((f) => [f.text, f.detail, f.metric, f.baseline, f.team, f.own_part].join('. ')).join('. '));
    const hide = (v: string) => { const t = saidValue(v); return t === undefined ? undefined : redact(t, held); };
    return { name: p.title.trim(), situation: hide(p.situation), what_i_did: hide(p.did), result: hide(p.result), learned: hide(p.learned),
      facts: mine.map((f) => `${f.text}${f.metric ? ` (${f.metric})` : ''}`) };
  }).filter((p) => p.situation || p.what_i_did || p.result || p.learned);
}
const carryingBlock = (ps: Carrying[]) => ps.length === 0 ? '' : `\n${LEARNED}\n${ps.map((p) => `- The project “${p.name}”. Its facts: ${p.facts.map((f) => `“${f}”`).join('; ')}.${p.situation ? ` Before: ${p.situation}` : ''}${p.what_i_did ? ` What they did: ${p.what_i_did}` : ''}${p.result ? ` What came of it: ${p.result}` : ''}${p.learned ? ` What they learned: ${p.learned}` : ''}`).join('\n')}\n`;

// The resume's number rule, for the drafts (lib/numbers.ts, unsupported): a number whose value stands in the context as
// stored (every project's name, background and what was learned) and in no fact, the profile, the posting or the person's
// note is not one to send. Only the value is compared. What a model wrote about the job (its strengths, its verdict, the
// title and employer it read from the posting) is no source: it may have been written from that same context. A count
// of years is left alone, as in a resume's summary: it comes from the role dates. A draft that prints "[number]" is
// sent back too.
function problemsIn(message: string, allowed: string, context: string, versions: string[]): string[] {
  return context.trim() === '' ? [] : unsupported(message, context, allowed, { versions });
}
const problemOf = (message: string, only: string[]) => (only.length > 0
  ? `“${message}” uses ${only.join(' and ')}, which the record has only in what the person learned or a project’s background, not in a fact. Take ${only.length === 1 ? 'it' : 'them'} out, or use a number the profile states.`
  : `“${message}” prints “${NUMBER_TOKEN}”, which marks a number left out because no fact holds it. Write it without the mark, or with a number the profile states.`);
const bad = (message: string, allowed: string, context: string, versions: string[]) => message.includes(NUMBER_TOKEN) || problemsIn(message, allowed, context, versions).length > 0;
const tidy = (d: Door | undefined): Door | undefined => (d && typeof d.message === 'string' && d.message.trim() !== '' ? { to: String(d.to ?? '').trim(), find: String(d.find ?? '').trim(), why: String(d.why ?? '').trim(), message: d.message.trim() } : undefined);
const clean = (doors: Door[] | undefined) => (doors ?? []).map(tidy).filter((d): d is Door => d !== undefined);
// What drafting gave: the drafts kept, and how many were left out because a number in them has no fact behind it.
export type Drafted = { doors: Door[]; left: number };

export async function draft(job: JobRow & { contact: string }, cwd: string): Promise<Drafted> {
  const a = job.analysis ? (JSON.parse(job.analysis) as { strengths?: string[]; verdict?: string; requirements?: { best?: string }[] }) : {};
  const profile = ((db.query('SELECT body FROM profile WHERE id = 1').get() as { body: string } | null)?.body ?? '').slice(0, 6000);
  const projects = carrying(a), kept = keptLines();
  const r = await ask<{ doors: Door[] }>({ cwd, schema: SCHEMA, timeoutMs: 8 * 60_000, model: process.env.EGG_OUTREACH_MODEL ?? process.env.EGG_MODEL ?? 'opus',
    prompt: `One person is applying for a job and wants to reach a human at the company instead of only sending an application into a form. Draft four short messages they could send, each by a different way in, including at least one way in they may not have thought of.

Ways in to choose from, best four for this job and company:
- someone they already know there${job.contact.trim() ? ' (they have noted who: use that note, and make this the first draft)' : ' (they have not noted anyone: write it for a former colleague or acquaintance who now works there, with the name left blank)'}
- the hiring manager for this role, or an engineer on the team it sits in
- a recruiter or talent partner at the company
- a former colleague elsewhere who is likely to know someone there and could introduce them
- someone at the company who shares a real background with them (a past employer, an industry, a school, a sport), where the profile shows one
- a person at the company who has written or spoken publicly about the kind of work this role does

For each:
- "to" names the kind of person in a few words ("The hiring manager", "A recruiter at Acme", "Someone you know there").
- "find" says in one sentence how to find that person: what to search for and where (a title to search on LinkedIn with the company's name, the team named in the posting, the company's engineering blog). Never invent a name.
- "why" is one sentence on why this way in suits this job.
- "message" is the message itself, ready to paste into LinkedIn or an email: at most 75 words, in the first person. It says who they are in one clause, gives one specific reason they fit this role drawn from real work in the profile (with its number where it has one), and makes one small, easy ask (a short call, the right person to talk to, a referral, a look at their application). It ends with their first name.

Rules for the messages:
- Every claim about the person comes from the profile below. Never invent an employer, a title, a number or a shared history.
- Anything you cannot know stands as a blank in square brackets for them to fill: [name], [how we know each other], [the post you read]. Use few of them.
- No flattery of the company, no "I hope this finds you well", no "I'm reaching out because", no "passionate", no exclamation marks. Sound like a capable person writing a short note to a peer.
- Each of the four leads with a different piece of their work, the one that person would care about most.

${WRITING}

Their name: ${person().name || '[your name]'}
${job.contact.trim() ? `Their note on who they know at the company: ${job.contact.trim()}\n` : ''}
The job: ${job.title}${job.company ? ` at ${job.company}` : ''}${job.place ? ` (${job.place})` : ''}
What carries their application, from an earlier reading of the posting:
${(a.strengths ?? []).map((x) => `- ${x}`).join('\n') || '- (not read yet)'}

The posting:
<posting>
${job.posting.slice(0, 8000)}
</posting>

Their profile:
<profile>
${profile}
</profile>${carryingBlock(projects)}${kept.length ? `\n${KEPT_LINES}\n${kept.map((l) => `- ${redact(l.text)}`).join('\n')}\n` : ''}${projects.length || kept.length ? `\n${NUMBER_MARK}\n` : ''}` });
  // The number check: what the drafts may say against what only the context says. The drafts with such a number are
  // sent back once; each answer takes the place of the draft it puts right, and a good draft stays where it was. A
  // draft that still has such a number is left out.
  const facts = (db.query('SELECT text, detail, metric, baseline, team, own_part, skills FROM facts').all() as Record<string, string>[]).map((f) => [f.text, f.detail, f.metric, f.skills, ...Object.values(factDetails(f))].join(' '));
  const allowed = [profile, job.posting, job.contact, ...facts].join(' ');
  const context = (db.query('SELECT title, situation, did, result, learned FROM projects WHERE via_role IS NULL AND role_id IS NOT NULL').all() as Record<string, string>[]).map((p) => Object.values(p).join(' ')).join(' ');
  const versions = versionNames();
  let doors = clean(r.doors).slice(0, 5);
  const problems = doors.map((d, i) => ({ d, i, only: problemsIn(d.message, allowed, context, versions) })).filter((x) => x.only.length > 0 || x.d.message.includes(NUMBER_TOKEN));
  if (problems.length > 0) {
    const again = await ask<{ doors: Door[] }>({ cwd, schema: SCHEMA, timeoutMs: 8 * 60_000, model: process.env.EGG_OUTREACH_MODEL ?? process.env.EGG_MODEL ?? 'opus',
      prompt: `You wrote these short messages for one person who is applying for ${job.title}${job.company ? ` at ${job.company}` : ''}. Some use a number that none of their facts states. Return every message, in the same order, with each problem below put right: take the number out, or use one their profile states. Change nothing else.

Problems:
${problems.map((x) => `- ${problemOf(x.d.message, x.only)}`).join('\n')}

The messages, as JSON:
${JSON.stringify({ doors })}

${WRITING}

Their profile:
<profile>
${profile}
</profile>` });
    const answer = again.doors ?? [];
    doors = doors.map((d, i) => (problems.some((x) => x.i === i) ? tidy(answer[i]) ?? d : d));
  }
  const kept2 = doors.filter((d) => !bad(d.message, allowed, context, versions));
  return { doors: kept2, left: doors.length - kept2.length };
}

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
// Keeps what drafting gave on its job, as the worker does, with a plain note the job screen shows when drafts were
// left out. When every new draft was left out the earlier drafts stay, so the screen never looks as if nothing was drafted.
export function storeDrafts(jobId: number, d: Drafted): void {
  const earlier = ((): Door[] => { try { return JSON.parse((db.query('SELECT outreach FROM jobs WHERE id = ?').get(jobId) as { outreach: string } | null)?.outreach || '[]') as Door[]; } catch { return []; } })();
  let doors = d.doors, note = '';
  if (d.doors.length === 0 && d.left > 0 && earlier.length > 0) { doors = earlier; note = 'The new drafts were left out: each used a number your record does not hold. These are the earlier drafts.'; }
  else if (d.doors.length === 0 && d.left > 0) note = 'Every draft was left out: each used a number your record does not hold. Draft again to have new ones written.';
  else if (d.left > 0) note = `${COUNT[d.left] ?? d.left} ${d.left === 1 ? 'draft was' : 'drafts were'} left out. ${d.left === 1 ? 'It' : 'Each'} used a number your record does not hold.`;
  db.query("UPDATE jobs SET outreach = ?, outreach_status = 'done', outreach_note = ? WHERE id = ?").run(JSON.stringify(doors), note, jobId);
}
