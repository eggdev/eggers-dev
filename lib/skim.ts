// Rule 12, the six-second skim: a last review of a written resume, separate from the council.
// One model call is shown only what a recruiter's first glance takes in (the name, the summary, and the
// first role's title, company, dates and first two bullets) and says what that reader would conclude, what
// questions the glance raises, and whether each of the posting's top three requirements is answered there.
// What the writer can fix (a requirement not answered at the top, an opening that misleads, and what the
// code checks found) is fixed by a rewrite and skimmed again, at most MAX_REVISIONS times. What only the
// person can settle (two current jobs, an overlap, a gap) is returned as a question. It is never guessed.
//
// The skim reads a few lines and returns a short answer, so it runs on the cheapest model: Haiku.
// EGG_SKIM_MODEL changes it. The rewrite uses the model that writes resumes. This file opens no database.
import { ask } from './llm.ts';
import { parseResume, skimView } from './resume.ts';

export const MAX_REVISIONS = 2;
export type TopAnswer = { requirement: string; answered: boolean; note: string };
// conclusion: what the glance leaves a recruiter thinking. questions: for the person. open: what the writer
// could not fix within the rounds. revisions: how many rewrites were made. saw: the lines the last skim read.
export type Skim = { conclusion: string; questions: string[]; open: string[]; top: TopAnswer[]; revisions: number; model: string; saw: string };
type Glance = { conclusion: string; misleading: string; questions: { question: string; who: 'writer' | 'person' }[]; top: TopAnswer[] };

const GLANCE = { type: 'object', additionalProperties: false, required: ['conclusion', 'misleading', 'questions', 'top'], properties: {
  conclusion: { type: 'string' }, misleading: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'who'], properties: { question: { type: 'string' }, who: { type: 'string', enum: ['writer', 'person'] } } } },
  top: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['requirement', 'answered', 'note'], properties: { requirement: { type: 'string' }, answered: { type: 'boolean' }, note: { type: 'string' } } } } } };
const REVISED = { type: 'object', additionalProperties: false, required: ['resume', 'changes'], properties: { resume: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } } };

export const skimModel = () => process.env.EGG_SKIM_MODEL ?? 'haiku';

const glance = (view: string, top: string[], asked: string, cwd: string) => ask<Glance>({ cwd, schema: GLANCE, timeoutMs: 5 * 60_000, model: skimModel(),
  prompt: `You are a recruiter with six seconds for one resume. You see only the lines below: the name, the summary, and the first role with its title, company, dates and first two bullets. You do not see the rest of the page, and you must not guess at it.

"conclusion": in one or two plain sentences, what you would conclude about this person from these lines alone: what they are, at what level, and whether you would read on.

"misleading": one sentence if the opening undersells or misrepresents the work the first role shows (for example a summary that opens on a title the bullets do not bear out), else "".

"questions": every question these lines would raise in your mind ("Is this a step down?", "Two current jobs?", "Why so many short roles?"), at most four, each a short question. For each, "who" says who can remove it:
- "writer" when rewording or reordering these lines would remove it.
- "person" when only the person's own history can settle it (two current jobs, overlapping dates, a gap, short roles, a title that does not fit the work). Never suggest an answer to one of these.
[] when the lines raise none.

"top": for each requirement listed below, in the same order and word for word, whether these lines visibly answer it ("answered": true only when a reader with no other knowledge would see it answered here), and a note of at most one sentence saying where, or what is missing.

The posting's top requirements:
${top.map((t) => `- ${t}`).join('\n') || '- (none were listed)'}
${asked}
The lines you see:
<top-of-page>
${view}
</top-of-page>` });

export type SkimContext = {
  top: { text: string; evidence: string }[]; // the posting's top three requirements, each with its strongest evidence
  posting: string; bank: string; rules: string; cwd: string;
  asked?: string; // questions the person already answered, so they are not raised again
  tidy?: (resume: string) => string; // what code puts right after every rewrite (header, entries, skills, and the fact keys taken out)
  show?: (resume: string) => string; // the text as the fix is given it: with each line's fact keys put back (lib/links.ts, annotate)
  found?: (resume: string) => string[]; // what the code checks found that a rewrite can fix, in plain words
  log?: (line: string) => void;
};

const fix = (resume: string, problems: string[], c: SkimContext) => ask<{ resume: string; changes: string[] }>({ cwd: c.cwd, schema: REVISED, timeoutMs: 15 * 60_000, model: process.env.EGG_JOB_MODEL ?? process.env.EGG_MODEL ?? 'opus',
  prompt: `You are fixing the top of a resume written for one job posting, after a reader who gave it six seconds reported what they saw. Return the whole resume.

Fix only what is listed under "What to fix". Change the Summary and the choice, order and wording of bullets. Change nothing else: every heading, title, employer, date, place and the Skills and Education sections stay exactly as they are.

- The bank below is everything known about the person. Never invent, round up or infer a number, title, date, technology or outcome. A number you show is exactly as the bank has it.
- A requirement is answered at the top when the Summary or one of the first role's first two bullets shows the work that answers it, from the bank. If the bank's evidence for it belongs to a later role, answer it in the Summary and keep that work in its own role's bullets.
- Never answer a question about the person's history (dates, two jobs at once, a gap) by rewording around it. Those go to the person.

${c.rules}

"changes" lists what you changed, each in one plain sentence addressed to the person as "you", at most six.

What to fix:
${problems.map((p) => `- ${p}`).join('\n')}

The posting's top requirements, each with the bank's strongest evidence for it:
${c.top.map((t) => `- ${t.text}${t.evidence ? ` Evidence: ${t.evidence}` : ''}`).join('\n') || '- (none were listed)'}

The posting:
<posting>
${c.posting.slice(0, 30_000)}
</posting>

The resume as it stands:
<resume>
${c.show ? c.show(resume) : resume}
</resume>

The bank, as JSON:
${c.bank}` });

// Skims, and rewrites while the skim or the code checks still find something a rewrite can fix, up to
// MAX_REVISIONS rewrites (so at most three skims). Returns the resume as it ended and what the last skim said.
export async function skimLoop(draft: string, c: SkimContext): Promise<{ resume: string; skim: Skim; changes: string[] }> {
  let resume = draft;
  const changes: string[] = [];
  for (let revisions = 0; ; revisions++) {
    const view = skimView(parseResume(resume));
    const g = await glance(view, c.top.map((t) => t.text), c.asked ?? '', c.cwd);
    // The answers are matched to the requirements by place, so a reworded requirement cannot go missing.
    const top = c.top.map((t, i): TopAnswer => ({ requirement: t.text, answered: g.top?.[i]?.answered === true, note: (g.top?.[i]?.note ?? '').trim() }));
    const fixable = [
      ...top.filter((t) => !t.answered).map((t) => `The top of the page does not answer this requirement: “${t.requirement}”.${t.note ? ` ${t.note}` : ''}`),
      ...((g.misleading ?? '').trim() ? [`The opening misleads: ${g.misleading.trim()}`] : []),
      ...(g.questions ?? []).filter((q) => q.who === 'writer').map((q) => `The first glance raises this question, which rewording can remove: ${q.question.trim()}`),
      ...(c.found?.(resume) ?? []),
    ];
    c.log?.(`skim: ${top.filter((t) => t.answered).length} of ${top.length} top requirements answered at the top, ${fixable.length} to fix`);
    const done = (): { resume: string; skim: Skim; changes: string[] } => ({ resume, changes, skim: { conclusion: (g.conclusion ?? '').trim(), top, revisions, model: skimModel(), saw: view,
      questions: (g.questions ?? []).filter((q) => q.who === 'person').map((q) => q.question.trim()).filter(Boolean).slice(0, 4), open: fixable } });
    if (fixable.length === 0 || revisions === MAX_REVISIONS) return done();
    const next = await fix(resume, fixable, c);
    if ((next.resume ?? '').trim() === '') return done();
    resume = c.tidy ? c.tidy(next.resume.trim()) : next.resume.trim();
    changes.push(...(next.changes ?? []).map((x) => x.trim()).filter(Boolean));
  }
}
