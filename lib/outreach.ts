// Reaching out: for one job, a few short messages the person can send to open a door, each by a
// different way in (someone they know there, the hiring manager, a recruiter, a former colleague
// who could introduce them). They are drafts to personalise: every claim comes from the bank, and
// anything the tool cannot know stands as a [bracketed] blank for the person to fill.
import { db } from './db.ts';
import { ask } from './llm.ts';
import { person } from './person.ts';
import { WRITING } from './writing.ts';
import type { JobRow } from './jobs.ts';


export type Door = { to: string; find: string; why: string; message: string };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['doors'], properties: { doors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['to', 'find', 'why', 'message'],
  properties: { to: { type: 'string' }, find: { type: 'string' }, why: { type: 'string' }, message: { type: 'string' } } } } } };

export async function draft(job: JobRow & { contact: string }, cwd: string): Promise<Door[]> {
  const a = job.analysis ? (JSON.parse(job.analysis) as { strengths?: string[]; verdict?: string }) : {};
  const profile = ((db.query('SELECT body FROM profile WHERE id = 1').get() as { body: string } | null)?.body ?? '').slice(0, 6000);
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
</profile>` });
  return (r.doors ?? []).map((d) => ({ to: d.to.trim(), find: d.find.trim(), why: d.why.trim(), message: d.message.trim() })).filter((d) => d.message !== '').slice(0, 5);
}
