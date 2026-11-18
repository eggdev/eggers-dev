// The council: three readers score a resume written for one posting, each from their own seat
// and each a different model, and name the lines that weaken it. A reviser then rewrites it from
// the bank, and they read it again: one round per reading. It stops when the readers average 8 of
// 10 with none below 7, or after three rewrites, and keeps the best version it saw. Nothing here
// adds a fact: the reviser has only the bank. A reader that cannot be reached gives no score and
// is named as such. No other model is put in its seat.
// The readers and the reviser are given the owner's resume rules (lib/writing.ts), so no reader asks for
// what a rule forbids and the reviser cannot trade a rule for a higher score.
import { bullets, REQUIRED } from './ats.ts';
import { ASKED } from './db.ts';
import { stripLinks } from './links.ts';
import { ask } from './llm.ts';
import { BULLETS, ENTRIES, METRICS, SIGNAL, SUMMARY, WRITING } from './writing.ts';

// score is -1 when the reader gave none. scores holds every round's, in order.
export type Seat = { seat: string; model: string; score: number; note: string; scores: number[] };
// questions are what the readers wanted and the bank could not give: for the person to answer (Talk).
// parser is the rule-based score (lib/ats.ts) of the version kept, where one was taken.
// problems: the lines the readers named as weak in the version kept (each with the seat, the words quoted and why), for the
// resume screen to show beside the line they stand in (lib/resumeview.ts). Absent from a review stored before them.
export type Weak = { seat: string; quote: string; why: string };
// problemsSig: the signature of the text those lines were read in, as code left it (lib/jobs.ts sets it): the screen shows
// them only while the stored resume is still that text.
export type Review = { score: number; rounds: number; passed: boolean; seats: Seat[]; changes: string[]; questions?: string[]; parser?: number; problems?: Weak[]; problemsSig?: string };
export type Parser = (resume: string) => { score: number; notes: string[] };
type Problem = { quote: string; why: string; fix: string };
type Reading = { score: number; note: string; problems: Problem[] };

export const PASS = 8, FLOOR = 7, MAX_REWRITES = 3;
const REVISER = () => process.env.EGG_COUNCIL_MODEL ?? process.env.EGG_JOB_MODEL ?? process.env.EGG_MODEL ?? 'opus';
const NAMES: Record<string, string> = { opus: 'Claude Opus', sonnet: 'Claude Sonnet', haiku: 'Claude Haiku', gpt: 'GPT' };
const named = (model: string) => NAMES[model] ?? (model.startsWith('gpt:') ? `GPT (${model.slice(4)})` : model);

// Each seat's model: EGG_COUNCIL_RECRUITER, EGG_COUNCIL_MANAGER and EGG_COUNCIL_EDITOR change them.
const SEATS: { seat: string; model: () => string; brief: string }[] = [
  { seat: 'Recruiter', model: () => process.env.EGG_COUNCIL_RECRUITER ?? 'haiku', brief: `You are a recruiter screening applications for this posting. You give a resume a few seconds first: name, current title, most recent employer and dates, then the top third of the page. Judge whether the match to this posting is obvious at that glance, whether the posting's own terms are where you would search for them, and whether anything is confusing, missing or out of order. Flag any line you would have to read twice.` },
  { seat: 'Hiring manager', model: () => process.env.EGG_COUNCIL_MANAGER ?? 'gpt', brief: `You are the engineering manager hiring for this posting. You read every bullet and ask "so what?". Judge whether each line shows real evidence of doing this job well. Flag every number that is unimpressive, trivial or odd for someone at this level (a count of tests, savings of a few hundred dollars, a launch date, a handful of anything), every bullet that is implementation trivia with no outcome, every claim you cannot picture or that means nothing to someone outside the company, and every line that makes the person look more junior than the rest of the page.` },
  { seat: 'Editor', model: () => process.env.EGG_COUNCIL_EDITOR ?? 'opus', brief: `You are an editor who removes anything that reads as filler or as machine-written. Judge the wording line by line against the rules below. Flag vague or abstract lines, buzzwords, unsupported benefit clauses, internal names left unexplained, repeated openings, and bullets that say two things at once.` },
];

const READING = { type: 'object', additionalProperties: false, required: ['score', 'note', 'problems'], properties: {
  score: { type: 'number' }, note: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['quote', 'why', 'fix'], properties: { quote: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' } } } } } };
const REVISED = { type: 'object', additionalProperties: false, required: ['resume', 'changes', 'questions'], properties: { resume: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } } };

const read = (seat: (typeof SEATS)[number], resume: string, posting: string, cwd: string, wishes: string, context: string) => ask<Reading>({ cwd, schema: READING, timeoutMs: 10 * 60_000, model: seat.model(),
  prompt: `${seat.brief}

Score the resume from 1 to 10 for this posting, from your seat:
- 10: nothing to change.
- 8: you would send it or pass it on as it is. No line weakens it.
- 6: decent, but several lines weaken it or the match is not obvious.
- 4 or lower: it would hurt the application.
Be strict. An 8 means you looked for a weak line and found none worth changing.

"note" is one or two plain sentences on what most holds the score down, or why it passes.
"problems" lists each line that should change, most damaging first, at most ten. "quote" is the exact words from the resume. "why" is one sentence. "fix" is what to do: cut it, cut a named number or detail from it, reword it (say how), or replace it with stronger work if the person has any. You cannot see the person's full record, so never propose a new fact or number.

Do not ask for anything that is not on the page to be invented. Do not object to the section names or the plain layout: applicant tracking systems need them. Do not object to length unless it clearly runs past its page limit.

Job titles, employers, dates, places, the labels beside the dates (Contract, Part-time, Own company, Personal project) and the order of roles are facts of the person's history. They cannot change, so never list them as problems and never lower your score for them. The Skills line is written from the person's own confirmed list, so do not ask for a skill to be added to it. The resume follows the rules at the end of this message: never ask for something they forbid (a longer summary, a Projects section, a bullet for an old role that has one, a title reworded).

Score the page, not the candidate. Whether the person has what the posting asks is measured elsewhere, as their fit. A requirement the page does not show (a language, a clearance, years of management) is not a problem with the resume and must not lower your score: no rewrite can add it. Lower your score only for what the page does badly with what it has: a weak or vague line, the wrong order, a strong point buried, wording that needs a second read. The same holds for the person's own wishes below, where they give any: score the page as written within them.${wishes ? `\n\nThe person's own wishes for their resume:\n<wishes>\n${wishes}\n</wishes>` : ''}

${SIGNAL}${context ? `\n\n${context}` : ''}

${WRITING}

${BULLETS}

${SUMMARY}

${ENTRIES}

The posting:
<posting>
${posting.slice(0, 30_000)}
</posting>

The resume:
<resume>
${seat.model().startsWith('gpt') ? masked(stripLinks(resume)) : stripLinks(resume)}
</resume>` });

// A reader outside this machine's own model gets the resume without the name and contact line.
const masked = (resume: string) => { const lines = resume.split('\n'), at = lines.findIndex((l) => /^##\s/.test(l)); return at < 0 ? resume : ['# [Name]', '[location and contact details]', '', ...lines.slice(at)].join('\n'); };

const revise = (resume: string, readings: { seat: string; r: Reading }[], posting: string, bank: string, limits: string, cwd: string, wishes: string, context: string, short = '', links = '') => ask<{ resume: string; changes: string[]; questions: string[] }>({ cwd, schema: REVISED, timeoutMs: 15 * 60_000, model: REVISER(),
  prompt: `You are revising a resume written for one job posting, after three readers reviewed it. Fix what they flagged and return the whole resume.

Rules that outrank the readers:
- The bank below is everything known about the person. Never invent, round up or infer a number, title, date, technology or outcome. A number you show is exactly as the bank has it.
- When a bullet is cut, replace it with stronger work from the bank for the same role if the bank has some that answers the posting. If it has none, the role has fewer bullets, and a role left with none goes on the Earlier experience line or is left out.
- Keep the Markdown structure exactly: "# Name" and the contact line as they are, then the sections the rules below allow. Each entry keeps its heading, its dates line, its "Previously" lines and its context lines exactly as they are. Do not change a title, company, date, label or place.
- Keep the posting's own terms inside the bullets whose work used them, wherever the bank honestly supports them. Never add them as a list.
- Leave the Skills line as it is: it is written from the person's own confirmed list.
- ${limits}
- Where two readers disagree, side with the one whose change makes the page clearer to a stranger.
- The rules below outrank the readers and the person's wishes alike. Where a reader asks for something a rule forbids, leave it and do not make the change.
${wishes ? `- The person's own wishes for their resume outrank the readers, and set emphasis only. Keep what they ask to keep (an earlier career they value, a line of scope under a title, what leads each role), at the weight they give it, as far as the rules below allow. Keeping something is not leading with it: the Summary opens on the work that answers this posting, and an earlier career stays a short entry in its place in the order. Their wishes add no facts: every line still needs the bank.\n<wishes>\n${wishes}\n</wishes>` : ''}

${SIGNAL}${context ? `\n\n${context}` : ''}

${METRICS}

${WRITING}

${BULLETS}

${SUMMARY}

${ENTRIES}${links ? `\n\n${links}` : ''}

"changes" lists what you changed, each in one plain sentence addressed to the person as "you" ("Cut the count of tests from the Stripe bullet: it read as small."), at most ten.

"questions" lists what the readers asked for that the bank cannot answer, as questions to the person that they could answer from memory, each naming the work it is about ("Who uses the billing export service day to day, and what did it replace or save them?"). At most four, the ones that would most raise the score. [] when the bank already answers everything asked.${ASKED()}

What the readers said:
${readings.map(({ seat, r }) => `${seat} (${r.score}/10): ${r.note}\n${r.problems.map((p) => `- "${p.quote}": ${p.why} Fix: ${p.fix}`).join('\n')}`).join('\n\n')}${mechanical(resume)}${short}

The posting:
<posting>
${posting.slice(0, 30_000)}
</posting>

The resume as it stands:
<resume>
${resume}
</resume>

The bank, as JSON:
${bank}` });

// What a rule-based check of the bullets found (lib/ats.ts): duties, the wrong tense for the role, bullets past a skim's length, one verb three times running.
// It never asks for a number: only the readers and the bank decide what is worth showing.
const mechanical = (resume: string) => { const f = bullets(stripLinks(resume)).flags.slice(0, 8); return f.length ? `\n\nA rule-based check of the bullets, with no score:\n${f.map((x) => `- "${x.quote}": ${x.why} Fix: ${x.fix}`).join('\n')}` : ''; };

const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(n * 2) / 2));

// `most` is how many rewrites it may make. With 0 the readers only score the text, and it comes back as it went in
// (for a resume the person edited, which is never rewritten).
// `context`: what a project of a role is, and "[number]" (CONTEXT in lib/writing.ts), when the bank sends either; '' when not.
// `links`: the rule on fact keys (LINKS in lib/writing.ts), given to the reviser only; '' when links are off. The draft may
// carry its lines' keys (lib/links.ts, annotate): the reviser sees them, and the readers and the rule-based check never do.
// `seen` hears each rewrite as the reviser returned it, so the keys it gave a line are known even when an earlier version is kept.
export async function council(draft: string, posting: string, bank: string, limits: string, cwd: string, log: (line: string) => void = () => {}, wishes = '', parser?: Parser, most = MAX_REWRITES, context = '', links = '', seen?: (resume: string) => void): Promise<{ resume: string; review: Review }> {
  let resume = draft.trim(), best = { resume, score: 0, seats: [] as Seat[], changes: [] as string[], parser: -1, problems: [] as Weak[] };
  const changes: string[] = [], history = SEATS.map(() => [] as number[]);
  let questions: string[] = [];
  const done = (rounds: number) => ({ resume: best.resume, review: { score: best.score, rounds, passed: passes(best.score, best.seats), ...(best.parser >= 0 ? { parser: best.parser } : {}), seats: best.seats.map((s, i) => ({ ...s, scores: history[i] })), changes: best.changes, questions, ...(best.problems.length ? { problems: best.problems } : {}) } });
  for (let rewrites = 0; ; rewrites++) {
    const readings = await Promise.all(SEATS.map(async (s) => {
      try { return { seat: s.seat, model: named(s.model()), r: await read(s, resume, posting, cwd, wishes, context).catch(() => read(s, resume, posting, cwd, wishes, context)) }; }
      catch (e) { return { seat: s.seat, model: named(s.model()), r: undefined, why: (e as Error).message }; }
    }));
    const seats: Seat[] = readings.map((x, i) => {
      const score = x.r ? clamp(x.r.score) : -1;
      history[i].push(score);
      return { seat: x.seat, model: x.model, score, note: x.r ? x.r.note.trim() : `No score: ${x.why}`, scores: [] };
    });
    const scored = seats.filter((s) => s.score >= 0);
    if (scored.length === 0) throw new Error(`No reader could be reached. ${seats[0].note}`);
    const score = mean(scored.map((s) => s.score));
    log(`council: ${seats.map((s) => `${s.seat} (${s.model}) ${s.score < 0 ? 'no score' : s.score}`).join(', ')} (average ${score})`);
    // A version that meets the parser bar is kept over one that does not, whatever the readers gave each.
    const p = parser?.(resume), ready = !p || p.score >= REQUIRED, bestReady = best.parser < 0 || best.parser >= REQUIRED;
    if (p) log(`parser score ${p.score}${ready ? '' : `, short of ${REQUIRED}`}`);
    const weak = readings.flatMap((x) => (x.r ? (x.r.problems ?? []).map((q) => ({ seat: x.seat, quote: String(q.quote ?? '').trim(), why: String(q.why ?? '').trim() })).filter((q) => q.quote !== '' && q.why !== '') : []));
    if (best.score === 0 || (ready && !bestReady) || (ready === bestReady && score > best.score)) best = { resume, score, seats, changes: [...changes], parser: p?.score ?? -1, problems: weak };
    if ((passes(score, seats) && ready) || rewrites >= most) return done(rewrites);
    const heard = readings.filter((x): x is typeof x & { r: Reading } => x.r !== undefined).map((x) => ({ seat: x.seat, r: x.r }));
    const short = p && !ready ? `\n\nA rule-based score of the page stands at ${p.score} of 100 and must reach ${REQUIRED}. What holds it down:\n${p.notes.map((n) => `- ${n}`).join('\n')}` : '';
    const next = await revise(resume, heard, posting, bank, limits, cwd, wishes, context, short, links);
    if (next.resume.trim() === '') return done(rewrites);
    resume = next.resume.trim();
    seen?.(resume);
    changes.push(...next.changes.map((c) => c.trim()).filter(Boolean));
    questions = next.questions.map((q) => q.trim()).filter(Boolean).slice(0, 4);
  }
}
const passes = (score: number, seats: Seat[]) => score >= PASS && seats.filter((s) => s.score >= 0).every((s) => s.score >= FLOOR);
