// A job: one posting, measured against the bank. Reading it answers three things:
//   what the posting requires, and for each requirement what in the bank supports it;
//   a tailored resume built only from bank facts, ordered and worded for this posting;
//   how that resume differs from the one the person supplied, and what would close the gaps.
// The fit number is computed here from the requirement coverage, not asked of the model, so two
// jobs are ranked by the same arithmetic and each score can be explained row by row.
//
// The resume follows the owner's twelve rules (RESUME-RULES.md; its last section says where each is applied).
// In short, for one resume: the posting is mapped first (assess), the writer is given that map, the top three
// requirements and the metrics inventory (compose), the council reviews it, a six-second skim reviews its top
// (lib/skim.ts), and after every step that a model wrote, code puts back the true headings and dates
// (lib/entries.ts) and writes the Skills line from the person's own list (lib/skills.ts). What code finds and
// cannot fix is kept as flags on the job (lib/checks.ts) or asked of the person (lib/raised.ts).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { db, type RoleRow } from './db.ts';
import { INBOX } from './ingest.ts';
import { ask } from './llm.ts';
import { council, type Review } from './council.ts';
import { ASKED } from './db.ts';
import { person, withHeader } from './person.ts';
import { BULLETS, ENTRIES, METRICS, SIGNAL, SUMMARY, WRITING } from './writing.ts';
import { inData } from './paths.ts';
import { draftScore } from './ats.ts';
import { atsCheck, pdfPath, renderPdf } from './pdf.ts';
import { direction, directionForMaterials, fitTest } from './direction.ts';
import { TARGETS } from './profile.ts';
import { fixable, flags, sigOf, syncQuestions, type Flag, type Written } from './checks.ts';
import { canonical, collapseEmpty, employers, repairEntries, type FactFinding } from './entries.ts';
import { inventory } from './metrics.ts';
import { answeredRaised } from './raised.ts';
import { lf } from './resume.ts';
import { skimLoop, type Skim } from './skim.ts';
import { withSkills } from './skills.ts';

export type JobRow = { edited?: number; id: number; url: string; posting: string; title: string; company: string; place: string; status: string; note: string; fit: number; analysis: string; resume: string; created_at: number; updated_at: number; outcome: string; outcome_note: string; contact: string; ats: string; pdf: string; pages: number; posted_at: number; salary: string; applied_at: number };
// `need` is must (the posting requires it), nice (it prefers it) or implied (it does not list it, but what it
// describes plainly needs it). A reading stored before "implied" existed has only the first two.
// `roles` are the bank's role keys ("role:12") whose work supports the requirement; `weight` and `basis`
// are worked out here from those roles, never by the model. `best` is the key of the single strongest evidence
// for it, one fact ("fact:57") or one role ("role:12"), checked here to exist, and `bestText` is that evidence in words.
export type Requirement = { text: string; need: 'must' | 'nice' | 'implied'; coverage: 'strong' | 'partial' | 'none'; evidence: string; roles?: string[]; best?: string; bestText?: string; weight?: number; basis?: string };
// The posting map as a resume was written from it: the top three requirements, each with its strongest evidence.
export type PostingMap = { top: { text: string; need: string; best: string; evidence: string }[] };
export type Knockout = { question: string; answer: 'yes' | 'no' | 'unknown'; note: string };
export type Terms = { inResume: string[]; inBankOnly: string[]; missing: string[] };
// The person's own fit test, answered for this posting: yes | partly | no | unknown.
export type Check = { question: string; answer: string; note: string };
// map, skim, questions and written are set when a resume is written; flags every time one is written or edited.
// questions are what the writer found too ambiguous in the bank to use. All are absent from an older reading.
export type Analysis = { verdict: string; requirements: Requirement[]; strengths: string[]; risks: string[]; changes: string[]; gaps: string[]; knockouts?: Knockout[]; terms?: Terms; checks?: Check[]; review?: Review;
  map?: PostingMap; skim?: Skim; flags?: Flag[]; questions?: string[]; written?: Written };

const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['title', 'company', 'place', 'verdict', 'requirements', 'strengths', 'risks', 'resume', 'changes', 'gaps', 'terms', 'knockouts', 'checks'],
  properties: {
    title: { type: 'string' }, company: { type: 'string' }, place: { type: 'string' }, verdict: { type: 'string' },
    requirements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'need', 'coverage', 'evidence', 'roles', 'best'],
      properties: { text: { type: 'string' }, need: { type: 'string', enum: ['must', 'nice', 'implied'] }, coverage: { type: 'string', enum: ['strong', 'partial', 'none'] }, evidence: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, best: { type: 'string' } } } },
    terms: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer', 'note'],
      properties: { question: { type: 'string' }, answer: { type: 'string', enum: ['yes', 'partly', 'no', 'unknown'] }, note: { type: 'string' } } } },
    knockouts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer', 'note'],
      properties: { question: { type: 'string' }, answer: { type: 'string', enum: ['yes', 'no', 'unknown'] }, note: { type: 'string' } } } },
    strengths: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } },
    resume: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } }, gaps: { type: 'array', items: { type: 'string' } },
  } };

// How much a piece of work counts as evidence. These numbers are a judgment, not a measured fact:
// hiring guides agree that paid production work outweighs side projects for senior roles and that
// recent work outweighs old, but none gives figures. Change them here and read the jobs again.
export const STANDING: Record<string, number> = { employer: 1, own: 1, contract: 0.95, personal: 0.6, '': 0.8 };
export const REACH: Record<string, number> = { live: 1, retired: 0.85, never: 0.55, '': 0.9 };
// By years since the work ended (a current role is 0).
export const recency = (years: number) => (years <= 2 ? 1 : years <= 5 ? 0.9 : years <= 8 ? 0.75 : 0.6);
const STANDING_WORD: Record<string, string> = { employer: 'employer', own: 'own company', contract: 'contract', personal: 'personal project', '': 'kind not set' };
const REACH_WORD: Record<string, string> = { live: 'in production', retired: 'was in production', never: 'never reached users', '': '' };

const yearsSince = (end: string, now: number) => {
  if (end === '' || end === 'present') return 0;
  const [y, m] = end.split('-').map(Number);
  return Math.max(0, (now - new Date(y, (m || 12) - 1, 28).getTime()) / (365.25 * 86_400_000));
};

// Fills each requirement's weight (0 to 1) and basis from the strongest role that supports it.
export function weigh(requirements: Requirement[], roles: RoleRow[], now: number): Requirement[] {
  const byKey = new Map(roles.map((r) => [`role:${r.id}`, r]));
  return requirements.map((q) => {
    if (q.coverage === 'none') return { ...q, weight: 0, basis: '' };
    const backing = (q.roles ?? []).map((k) => byKey.get(k)).filter((r): r is RoleRow => r !== undefined);
    let best = { w: STANDING[''] * REACH[''], basis: 'General experience' };
    if (backing.length > 0) {
      best = { w: 0, basis: '' };
      for (const r of backing) {
        // A project filed under an employer counts as that employer's work, unless it was classed itself.
        const parent = r.part_of === null ? undefined : roles.find((x) => x.id === r.part_of);
        const standing = r.standing || parent?.standing || '', reach = r.reach || parent?.reach || '';
        const years = yearsSince(r.end === '' && r.start === '' ? '' : r.end, now);
        const w = (STANDING[standing] ?? STANDING['']) * (REACH[reach] ?? REACH['']) * recency(years);
        const when = years <= 2 ? 'recent' : `${Math.round(years)} years ago`;
        const name = parent ? `${parent.company} (${r.company.split('/').pop()})` : r.company;
        if (w > best.w) best = { w, basis: [name, STANDING_WORD[standing] ?? STANDING_WORD[''], REACH_WORD[reach] ?? '', when].filter(Boolean).join(', ') };
      }
    }
    return { ...q, weight: Math.round((q.coverage === 'strong' ? 1 : 0.5) * best.w * 100) / 100, basis: best.basis };
  });
}

// Required things count three times a nice-to-have, and an implied one twice (a judgment, like the weights
// above). Each requirement counts by its weight when it has one (weigh above), else by coverage alone: full
// for strong, half for partial. 0 to 100.
export function fitOf(requirements: Requirement[]): number {
  const need = (r: Requirement) => (r.need === 'must' ? 3 : r.need === 'implied' ? 2 : 1);
  const total = requirements.reduce((n, r) => n + need(r), 0);
  if (total === 0) return 0;
  const got = requirements.reduce((n, r) => n + need(r) * (r.weight ?? (r.coverage === 'strong' ? 1 : r.coverage === 'partial' ? 0.5 : 0)), 0);
  return Math.round((got / total) * 100);
}

// The top requirements of a posting (rule 1): the ones a resume must answer in the top third of page one.
// "Top" is: required before implied before preferred, then by weight (how strongly the bank answers it), then
// the posting's own order. A requirement the bank does not cover at all is left out: it cannot be answered
// honestly, and it is already listed as a risk and lowers the fit.
export function topRequirements(requirements: Requirement[], n = 3): Requirement[] {
  const rank = (r: Requirement) => (r.need === 'must' ? 0 : r.need === 'implied' ? 1 : 2), w = (r: Requirement) => r.weight ?? (r.coverage === 'strong' ? 1 : 0.5);
  return requirements.map((r, i) => ({ r, i })).filter((x) => x.r.coverage !== 'none').sort((a, b) => rank(a.r) - rank(b.r) || w(b.r) - w(a.r) || a.i - b.i).slice(0, n).map((x) => x.r);
}

// Whether each of the posting's own terms appears, as written, in the resume: what a recruiter's
// keyword search or an applicant tracking system's match would find. A term the bank has but the
// resume lacks is a fixable miss, named to the writer and the person but never pasted in (a keyword belongs in
// a bullet beside its evidence); one the bank lacks is a real gap and is never added.
// A short term ("Go", "C", "R") is also an ordinary word, so the bank counts as having it only
// when it is listed among a fact's skills.
export function termsOf(terms: string[], resume: string, bankText: string, skills?: Set<string>): Terms {
  const has = (hay: string, t: string) => new RegExp(`(^|[^a-z0-9+#])${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`).test(hay);
  const r = resume.toLowerCase(), b = bankText.toLowerCase();
  const seen = new Set<string>(), out: Terms = { inResume: [], inBankOnly: [], missing: [] };
  for (const raw of terms) {
    const t = raw.trim();
    if (t === '' || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const banked = skills && t.length <= 3 ? skills.has(t.toLowerCase()) : has(b, t);
    (has(r, t) ? out.inResume : banked ? out.inBankOnly : out.missing).push(t);
  }
  return out;
}

// The posting's text from its page: the structured job description when the page carries one, else its visible text.
export async function fetchPosting(url: string): Promise<string> {
  let html: string;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; job-posting-reader)', accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`the page answered ${res.status}`);
    html = await res.text();
  } catch (e) { throw new Error(`Couldn’t open that link (${(e as Error).message}). Add it again from Jobs with the same link and the posting’s text pasted in.`); }
  const strip = (h: string) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = [JSON.parse(m[1])].flat().find((j) => j && j['@type'] === 'JobPosting');
      if (found?.description) return `${found.title ?? ''}\n${found.hiringOrganization?.name ?? ''}\n\n${strip(String(found.description))}`.trim();
    } catch { /* not JSON we can read */ }
  }
  const text = strip(html);
  if (text.length < 400) throw new Error('That page shows too little text to read (it may need a sign-in or a browser). Add it again from Jobs with the same link and the posting’s text pasted in.');
  return text.slice(0, 60_000);
}

// The resume the person supplied, to say how the tailored one differs: the inbox file whose source or name says resume.
function suppliedResume(): string | undefined {
  const files = (db.query("SELECT body FROM sources WHERE kind = 'file' ORDER BY id").all() as { body: string }[]).map((s) => s.body).filter((f) => existsSync(`${INBOX}/${f}`));
  return files.find((f) => /resume|cv/i.test(f)) ?? files[0];
}

const allRoles = () => db.query('SELECT * FROM roles').all() as RoleRow[];
const metricFacts = () => db.query("SELECT id, role_id, metric FROM facts WHERE metric != '' ORDER BY id").all() as { id: number; role_id: number | null; metric: string }[];

// The bank as a model is given it. Each employer is one entry (lib/entries.ts), however many rows the bank has
// for it, and carries the exact heading, dates line, "previously" lines, note and Earlier experience text a
// resume must use for it. Under it are the titles held there, each with its facts and the projects done in it.
// Every fact and role has a key, so a requirement can name its evidence. The metrics inventory (lib/metrics.ts)
// goes with it. `lean` leaves out each fact's story and the inventory: the first reading judges coverage from
// the facts and their results alone, and is quicker for it.
function bank(lean = false) {
  const roles = allRoles(), now = Date.now();
  const facts = db.query('SELECT id, role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all() as { id: number; role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string }[];
  const shape = (f: (typeof facts)[number]) => ({ key: `fact:${f.id}`, kind: f.kind, text: f.text, detail: lean ? undefined : f.detail, metric: f.metric, skills: f.skills });
  const of = (id: number | null) => facts.filter((f) => f.role_id === id).map(shape);
  const entries = employers(roles).map((g) => {
    const c = canonical(g), head = g.rows[0];
    return { heading: c.heading, dates: c.dates, previously: c.previously.length ? c.previously : undefined, note: c.note || undefined, earlier: c.earlier,
      kind: STANDING_WORD[head.standing] ?? STANDING_WORD[''], reach: REACH_WORD[head.reach] ?? '', current: g.rows.some((r) => r.start !== '' && r.end === ''),
      ended_years_ago: Math.floor(Math.min(...g.rows.map((r) => yearsSince(r.end, now)))),
      roles: g.rows.map((r) => ({ key: `role:${r.id}`, title: r.title, start: r.start, end: r.end || 'present', facts: of(r.id),
        // A project filed under an employer is nested in it, so it reads as work done in that job.
        projects: g.children.filter((p) => p.part_of === r.id).map((p) => ({ key: `role:${p.id}`, name: p.company, start: p.start, end: p.end || 'present', reach: REACH_WORD[p.reach] || undefined, facts: of(p.id) })).filter((p) => p.facts.length > 0) })) };
  }).filter((e) => e.roles.some((r) => r.facts.length > 0 || r.projects.length > 0));
  return { entries, general: [...of(null), ...facts.filter((f) => f.role_id !== null && !roles.some((r) => r.id === f.role_id)).map(shape)],
    metrics_inventory: lean ? undefined : inventory(metricFacts()).map((m) => ({ fact: `fact:${m.fact}`, role: m.role === null ? '' : `role:${m.role}`, kind: m.kind, metric: m.text })) };
}

// The length budget for one resume. The limits for old and unrelated roles are rule 8; the skills cap is rule 7.
const limits = (pages: number) => (pages === 1
  ? 'It must fit on ONE page when printed: at most 400 words in all, counting everything. A bullet is one sentence of at most 22 words. The two roles that matter most for this posting get up to four bullets each and one more gets two. Every other role is left out or named on the Earlier experience line. Skills is one line of at most fourteen items.'
  : 'It must fit on two pages when printed: 700 to 850 words in all, never under 660. A bullet is one sentence of at most 28 words. The current role and the one before it get up to five bullets each, and the next most relevant up to three. A role that ended 8 or more years ago, or that is outside the field of this posting, gets one bullet at most, or goes on the Earlier experience line. Skills is one line of at most 25 items.');

// The whole instruction for reading a posting. `withResume` leaves out the two items that write the
// resume, for the first, fast reading that only says where the person stands.
function reading(posting: string, pages: number, resume: string | undefined, withResume: boolean, lean = false): string {
  return `You are measuring one job posting against one person's knowledge bank, and writing the resume they should send for it.

The bank is everything you know about the person. Never invent, round up or infer a number, title, date, technology or outcome. If the bank does not show something, the person does not have it for this purpose.

1. Read the posting. "title", "company" and "place" (location or "Remote", "" if unsaid) come from it.

2. "requirements": every distinct thing the posting asks for, in the posting's order, each in a short phrase close to the posting's wording. Split compound lines. Skip boilerplate (benefits, equal opportunity text).
   - "need" is "must" for what the posting requires or clearly centres on, and "nice" for what it calls preferred, a plus or a bonus.
   - Then add what the posting implies and does not list, each with a "need" of "implied": something the work it describes plainly needs ("scale to millions of users" implies experience running systems at scale; "our first engineer" implies working alone). At most five, each in a short phrase that names the need, and only where the posting's own words support it.
   - "coverage" is "strong" when the bank has specific work that directly shows it, "partial" when the bank shows something adjacent, shorter or smaller than asked, and "none" when the bank shows nothing.
   - "roles" lists the keys ("role:12") of the bank roles or projects whose work supports it, strongest first, at most four; [] when coverage is "none" or the support is general (education, a skills list).
   - "best" is the key of the single strongest piece of evidence in the bank for it: one fact ("fact:57"), or one role ("role:12") when no single fact carries it (years of experience, a title held). Choose the fact a hiring manager would find most convincing: recent, in production, with a measured result. "" when coverage is "none".
   - "evidence" names the work that supports it in one sentence ("Led five engineers on the billing export at Acme, 2021 to now"), or says what is missing when coverage is "none". Be strict: years of experience are counted from role dates; a technology counts only where the bank shows it used.

3. "verdict": three or four plain sentences to the person: how well they fit, what carries the application, what is most likely to get it screened out, and whether it is worth applying.
   "strengths": up to five, the points a recruiter for this job would care most about, each tied to named work.
   "risks": up to five, the gaps or mismatches a screener would notice, most serious first. List one only if a screener at this company would plausibly hold it against the application. Where the person works from (remote, hybrid, an office) is a risk only when the bank shows they cannot or will not do what the posting needs. A requirement the bank answers directly (work authorisation, travel, being on site) is not a risk. Being the only engineer who builds for a company's departments counts as working with customers and their teams.
${withResume ? `
4. "resume": the resume to send for this posting, as Markdown, built only from the bank.
   - First line "# " and the person's name${person().name ? ` ("${person().name}")` : ' if the bank or the supplied resume gives it'}, then one line of contact details. That line is written over afterwards from the person's own details, so do not spend effort on it.
   - A recruiter's first pass takes six seconds and takes in the name, the Summary, and the first role's title, employer, dates and first two bullets. What answers this posting must be there.
   - "## Summary": as "The Summary" below says.
   - "## Experience": the bank's "entries", newest first, each written as "Sections and entries" below says. Each entry carries a "kind" (employer, own company, contract, personal project, or not set) and a "reach" (in production, was in production, never reached users). Lead with paid and production work. A personal project is shown only where it answers one of the posting's top requirements that the paid work does not: as its own entry, with its "Personal project" label, and never more than two.
   - Under each entry, the bullets chosen and ordered for this posting as "Bullets" below says, each in the form action, what it was for, result. A number you show is exactly as the bank has it. Leave out work that does not help this application.
   - "## Skills": one line of the tools, languages and platforms the bank shows in use, the most relevant to this posting first. No soft skills, no practices, and no phrase taken from the posting ("cross-team", "enterprise", "reliability"). This line is written over afterwards from the person's own confirmed skills list, so a posting's keyword put here is lost: it belongs in a bullet.
   - "## Education" when the bank has it.
   - ${limits(pages)}
   - Dates are written only on the line under each entry's heading, as the bank's entry gives them.

5. "changes": ${resume ? `read the resume the person supplied, the file "./${resume}" in the current directory, and list up to eight specific differences between it and the resume you wrote, each with its reason: what was added from the bank that the supplied resume lacks, what was cut or shortened, what was reordered or reworded for this posting.` : 'the person supplied no resume file, so return an empty list.'}
` : ''}
6. "terms": the posting's hard keywords exactly as it writes them, up to thirty: technologies, tools, methods, domain terms and the job title. These are what a recruiter searches for and what an applicant tracking system matches. No soft phrases ("team player").
   Use each of these terms in the resume, in the posting's spelling, inside the bullet whose work used it, wherever the bank honestly supports it. Never add one the bank does not support, and never add them as a list.

7. "knockouts": the yes-or-no screening questions this posting is likely to ask on its application form (work authorisation, location or time zone, minimum years, a required degree or clearance, willingness to travel or be on site), each with the answer the bank supports ("yes", "no", or "unknown" when the bank does not say) and a short note. Up to six; [] if the posting implies none.

8. "gaps": up to six questions the person could answer from memory that would most raise their fit for this posting, each naming the requirement it would support. Only ask about things they plausibly did.${ASKED()}

${person().location ? `   The person lives in ${person().location}. Use that for any question about location, time zone or being on site.\n\n` : ''}9. "checks": ${fitTest().length ? `the person's own fit test for a listing. Answer each question for this posting from what the posting says ("yes", "partly", "no", or "unknown" when it does not say, as with pay it does not state), with a one-sentence note naming what in the posting decides it. The questions, to be returned word for word:\n${fitTest().map((q) => `   - ${q}`).join('\n')}` : 'return [].'}
   The verdict should take these into account alongside the requirements: a posting that matches skills but fails the person's own test is a weaker choice, and say so.

${SIGNAL}

${WRITING}

${withResume ? `${BULLETS}\n\n${SUMMARY}\n\n${ENTRIES}\n\n${METRICS}\n\n` : ''}The person is looking for these kinds of role: ${TARGETS.list.join('; ')}.
${directionForMaterials() ? `\nTheir own notes on their direction follow. In the resume they set emphasis only: what to lead with among the work that answers this posting, a line of scope under a title, which earlier work they value. They never override a rule above. Titles, employers and dates stay as the bank has them. The Summary keeps its three parts and its length. Only the allowed sections are written. An old or unrelated role keeps its limit of one bullet. Tense follows the role, and the rules on numbers hold. Where a note asks for something a rule forbids, follow the rule. The notes do not add facts: every line still needs the bank.\n<direction>\n${directionForMaterials()}\n</direction>\n` : ''}${direction() && direction() !== directionForMaterials() ? '\nPart of their notes is a personal lens they use to think about fit. It is not shown to you and must never appear in the resume.\n' : ''}

The posting:
<posting>
${posting.slice(0, 60_000)}
</posting>

The bank, as JSON:
${JSON.stringify(bank(lean))}`;
}

const READ_SCHEMA = { ...SCHEMA, required: SCHEMA.required.filter((k) => k !== 'resume' && k !== 'changes'),
  properties: Object.fromEntries(Object.entries(SCHEMA.properties).filter(([k]) => k !== 'resume' && k !== 'changes')) };
const WRITE_SCHEMA = { type: 'object', additionalProperties: false, required: ['resume', 'changes', 'questions'], properties: { resume: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } } };
type Read = { title: string; company: string; place: string; terms: string[]; knockouts: Knockout[]; checks: Check[] } & Omit<Analysis, 'terms' | 'knockouts' | 'checks' | 'changes' | 'review'>;

// Keeps a requirement's "best" only when it names a fact or role the bank really has, and says that evidence in words.
function withBest(requirements: Requirement[]): Requirement[] {
  const facts = new Map((db.query('SELECT id, text, metric FROM facts').all() as { id: number; text: string; metric: string }[]).map((f) => [`fact:${f.id}`, `${f.text}${f.metric ? ` [${f.metric}]` : ''}`]));
  const roles = new Map(allRoles().map((r) => [`role:${r.id}`, r.title ? `${r.title}, ${r.company}` : r.company]));
  return requirements.map((q) => { const key = (q.best ?? '').trim(), text = q.coverage === 'none' ? undefined : facts.get(key) ?? roles.get(key); return { ...q, best: text ? key : '', bestText: text ?? '' }; });
}

// The first reading, and the posting map of rule 1: what the posting asks (required, preferred, implied), how
// the bank covers each thing and the single strongest evidence for it, and so the fit. Quick, so the
// person sees where they stand in under a minute. Measured 2026-11-11 on one posting: Sonnet at low effort
// took 37 s and wrote 6K tokens; Haiku took 90 s and wrote 21K, at any effort. EGG_READ_MODEL changes it. `resume` is the
// resume the job already has, if any, so its keyword count stays right until a new one is written.
export async function assess(posting: string, resume = ''): Promise<{ title: string; company: string; place: string; analysis: Analysis; fit: number; terms: string[] }> {
  if ((db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n === 0) throw new Error('Your record is empty. Add a source first.');
  const r = await ask<Read>({ cwd: INBOX, schema: READ_SCHEMA, timeoutMs: 10 * 60_000, model: process.env.EGG_READ_MODEL ?? 'sonnet', effort: 'low',
    prompt: reading(posting, 2, undefined, false, true).replace("You are measuring one job posting against one person's knowledge bank, and writing the resume they should send for it.", "You are measuring one job posting against one person's knowledge bank, so they can see where they stand. The resume is written afterwards, separately.") });
  const requirements = withBest(weigh(r.requirements, allRoles(), Date.now()));
  const analysis: Analysis = { verdict: r.verdict.trim(), requirements, strengths: r.strengths, risks: r.risks, changes: [], gaps: r.gaps,
    knockouts: r.knockouts, terms: termsOf(r.terms, resume, bankText(), bankSkills()), checks: r.checks };
  return { title: r.title.trim(), company: r.company.trim(), place: r.place.trim(), analysis, fit: fitOf(requirements), terms: r.terms };
}

// A resume could not be kept because an entry in it matches nothing in the bank, in every version written.
export class FactsError extends Error {
  findings: FactFinding[];
  constructor(findings: FactFinding[]) {
    super(`The resume that was written was not kept: ${findings.map((f) => f.text).join(' ')} Nothing true could be put in its place, so your earlier resume, if there is one, stands. Ask for it to be written again.`);
    this.findings = findings;
  }
}

// What code puts right in any resume a model wrote, in this order: the person's own name and contact line, each
// entry's heading and dates from the bank, an entry with no bullets moved to the Earlier experience line, and
// the Skills line from the person's own list. Never used on a resume the person edited.
function tidy(text: string, posting: string, pages: number, roles: RoleRow[]) {
  const fixed = repairEntries(withHeader(lf(text).trim()), roles);
  return { ...fixed, resume: withSkills(collapseEmpty(fixed.resume, roles), posting, pages) };
}

// What the writer is told beyond the reading: the posting map with each requirement's strongest evidence, the
// top three to answer at the top of page one, and what the person decided about their timeline.
function brief(requirements: Requirement[], top: Requirement[], terms: string[]): string {
  const word = { must: 'required', implied: 'implied', nice: 'preferred' } as const;
  const line = (q: Requirement) => `[${word[q.need] ?? 'preferred'}, ${q.coverage}] ${q.text}${q.best ? ` Strongest evidence: ${q.best} “${q.bestText}”` : q.coverage === 'none' ? ' The bank has nothing for this: do not claim it.' : ` ${q.evidence}`}`;
  const decided = answeredRaised('timeline').filter((q) => q.answer.trim() !== '');
  return `The posting has already been read and scored. Return only "resume" (item 4), "changes" (item 5) and "questions". The other items are here so you read the posting the same way. Its terms, as found then, are: ${terms.join(', ') || 'none found'}.

The posting map, as it was read: each requirement, how well the bank covers it, and the single strongest evidence for it. Answer each requirement the bank covers with that evidence, in a bullet of the role it belongs to.
${requirements.map((q) => `- ${line(q)}`).join('\n') || '- (no requirements were listed)'}

The top three requirements of this posting are:
${top.map((q, i) => `${i + 1}. ${q.text}${q.best ? ` Strongest evidence: ${q.best} “${q.bestText}”` : ''}`).join('\n') || '(none were listed)'}
Each of these must be visibly answered in the top third of page one: in the Summary, or in the first two bullets of the first role. Where a requirement's strongest evidence belongs to a later role, answer it in the Summary and keep that work in its own role's bullets. Never answer one with something the bank does not show.

The metrics inventory is the bank's "metrics_inventory". "Keeping the best metrics" above says how it binds you.
${decided.length ? `\nWhat the person decided about their timeline. Follow it. Roles they asked to group go together on the Earlier experience line.\n${decided.map((q) => `- ${q.text} They answered: ${q.answer}`).join('\n')}\n` : ''}
"questions": what in the bank was too ambiguous to use (who owned the work, what a number measured, which role a fact belongs to), each as a question the person could answer from memory that names the work. At most three. [] when nothing was.${ASKED()}`;
}

// What compose returns. repairs are facts code put back, in plain words. skim is absent when EGG_SKIM is off.
export type Composed = { resume: string; changes: string[]; review?: Review; terms: Terms; map: PostingMap; skim?: Skim; questions: string[]; repairs: string[] };

// The second step, in the background: the resume for the posting from its map (`requirements`, as assess
// stored them), then the council's review of it, then the six-second skim. After each, code puts right what
// it can (tidy). A version in which an entry matches nothing in the bank is never returned: the newest
// version without such an entry is, and if there is none this throws FactsError and nothing is stored.
// Set EGG_COUNCIL=off or EGG_SKIM=off to skip a review (a quick run, or a test).
export async function compose(posting: string, pages: number, terms: string[], requirements: Requirement[] = []): Promise<Composed> {
  // The skills list and the questions follow the bank. A failure there must never stop a resume.
  try { syncQuestions(Date.now()); } catch (e) { console.log(`  questions could not be checked: ${(e as Error).message}`); }
  const supplied = suppliedResume(), roles = allRoles(), top = topRequirements(requirements), log = (l: string) => console.log(`  ${l}`);
  const r = await ask<{ resume: string; changes: string[]; questions: string[] }>({ cwd: INBOX, schema: WRITE_SCHEMA, tools: supplied ? ['Read'] : [], allow: supplied ? ['Read'] : [],
    timeoutMs: 25 * 60_000, model: process.env.EGG_JOB_MODEL ?? process.env.EGG_MODEL ?? 'opus',
    prompt: `${reading(posting, pages, supplied, true)}\n\n${brief(requirements, top, terms)}` });
  // Every fact code puts back on the way to the version that is kept is remembered, to tell the person.
  const putBack = new Set<string>(), words = bankText(), skills = bankSkills(), whole = JSON.stringify(bank());
  const fix = (text: string) => { const v = tidy(text, posting, pages, roles); for (const f of v.repaired) putBack.add(f.text); return v; };
  const draft = fix(r.resume);
  // Scored as it will be sent: with its header, its true headings and its Skills line. No posting term is pasted in.
  const reviewed = process.env.EGG_COUNCIL === 'off' ? { resume: draft.resume, review: undefined } : await council(draft.resume, posting, whole, limits(pages), INBOX, log, directionForMaterials(),
    (text) => { const sent = tidy(text, posting, pages, roles).resume, t = termsOf(terms, sent, words, skills); return draftScore(sent, [...t.inResume, ...t.inBankOnly], pages, [...skills]); });
  const afterCouncil = fix(reviewed.resume);
  const skimmed = process.env.EGG_SKIM === 'off' ? undefined : await skimLoop(afterCouncil.resume, { top: top.map((q) => ({ text: q.text, evidence: q.bestText || q.evidence })), posting, bank: whole, cwd: INBOX, asked: ASKED(), log,
    rules: [SUMMARY, BULLETS, ENTRIES, METRICS, SIGNAL, WRITING, `Length: ${limits(pages)}`].join('\n\n'), tidy: (text) => fix(text).resume, found: (text) => fixable(text, pages) });
  // The newest version first. One with an entry the bank does not have is passed over for the one before it.
  const versions = [...(skimmed ? [fix(skimmed.resume)] : []), afterCouncil, draft], kept = versions.find((v) => v.unresolved.length === 0);
  if (!kept) throw new FactsError(versions[0].unresolved);
  const passedOver = versions.indexOf(kept) > 0 ? ['A later version of this resume named a job your record does not have, so the version before it was kept.'] : [];
  return { resume: kept.resume, changes: [...r.changes, ...(skimmed && versions.indexOf(kept) === 0 ? skimmed.changes : [])], review: reviewed.review, terms: termsOf(terms, kept.resume, words, skills),
    map: { top: top.map((q) => ({ text: q.text, need: q.need, best: q.best ?? '', evidence: q.bestText || q.evidence })) }, skim: skimmed?.skim,
    questions: (r.questions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3),
    repairs: [...passedOver, ...[...putBack].map((text) => `The writer changed a fact, and it was put back from your record. ${text}`)] };
}

// Keeps what compose wrote on its job, as the worker does: the resume, and in the job's analysis the review, the
// terms, the posting map, the skim, the writer's questions and what was repaired. False when the job is gone or
// was asked for again while this one was being written: then nothing is kept and the next one is written.
export function storeComposed(jobId: number, c: Composed, bankSig: string, now: number): boolean {
  const cur = db.query('SELECT analysis, resume_status, company, title FROM jobs WHERE id = ?').get(jobId) as { analysis: string; resume_status: string; company: string; title: string } | null;
  if (!cur || cur.resume_status !== 'running') return false;
  const analysis: Analysis = { ...(JSON.parse(cur.analysis) as Analysis), changes: c.changes, review: c.review, terms: c.terms, map: c.map, skim: c.skim, questions: c.questions, written: { sig: sigOf(c.resume), repairs: c.repairs } };
  db.query("UPDATE jobs SET resume = ?, analysis = ?, edited = 0, resume_status = 'done', bank_sig = ?, updated_at = ? WHERE id = ?").run(c.resume, JSON.stringify(analysis), bankSig, now, jobId);
  saveResume({ id: jobId, company: cur.company, title: cur.title }, c.resume);
  return true;
}

// Both steps, one after the other: for the tools that read every job again.
export async function analyze(posting: string, pages = 2): Promise<{ title: string; company: string; place: string; resume: string; analysis: Analysis; fit: number }> {
  const a = await assess(posting), c = await compose(posting, pages, a.terms, a.analysis.requirements);
  return { title: a.title, company: a.company, place: a.place, resume: c.resume, fit: a.fit,
    analysis: { ...a.analysis, changes: c.changes, review: c.review, terms: c.terms, map: c.map, skim: c.skim, questions: c.questions, written: { sig: sigOf(c.resume), repairs: c.repairs } } };
}

export const bankSkills = () => new Set((db.query('SELECT skills FROM facts').all() as { skills: string }[]).flatMap((f) => f.skills.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)));
const bankText = () => (db.query('SELECT text, detail, metric, skills FROM facts').all() as Record<string, string>[]).map((f) => Object.values(f).join(' ')).join(' ');

const EMPTY: Analysis = { verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] };

// The council and then the skim, for a resume already written: reviewed, rewritten if it falls short, put right
// by code (tidy), saved and printed again. The fit and the reading of the posting are left as they were.
// - A resume the person edited is never rewritten: the readers only score it, and its flags are taken again.
// - A rewrite that names a job the bank does not have is not kept. The resume stays as it was, says why
//   (keepEarlier), and the review of the version that was thrown away is not stored: this then returns undefined.
export async function review(job: JobRow, print = true): Promise<Review | undefined> {
  try { syncQuestions(Date.now()); } catch (e) { console.log(`  questions could not be checked: ${(e as Error).message}`); }
  const analysis: Analysis = job.analysis ? JSON.parse(job.analysis) : { ...EMPTY }, roles = allRoles(), whole = JSON.stringify(bank()), log = (l: string) => console.log(`  ${l}`);
  if (job.edited === 1) {
    const read = await council(job.resume, job.posting, whole, limits(job.pages), INBOX, log, directionForMaterials(), undefined, 0);
    analysis.review = read.review;
    db.query('UPDATE jobs SET analysis = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(analysis), Date.now(), job.id);
    reflag(job.id);
    return read.review;
  }
  const fix = (text: string) => tidy(text, job.posting, job.pages, roles), top = topRequirements(analysis.requirements);
  const got = await council(withHeader(job.resume), job.posting, whole, limits(job.pages), INBOX, log, directionForMaterials());
  const afterCouncil = fix(got.resume);
  const skimmed = process.env.EGG_SKIM === 'off' ? undefined : await skimLoop(afterCouncil.resume, { top: top.map((q) => ({ text: q.text, evidence: q.bestText || q.evidence })), posting: job.posting, bank: whole, cwd: INBOX, asked: ASKED(), log,
    rules: [SUMMARY, BULLETS, ENTRIES, METRICS, SIGNAL, WRITING, `Length: ${limits(job.pages)}`].join('\n\n'), tidy: (text) => fix(text).resume, found: (text) => fixable(text, job.pages) });
  const versions = [...(skimmed ? [fix(skimmed.resume)] : []), afterCouncil], kept = versions.find((v) => v.unresolved.length === 0);
  if (!kept) { keepEarlier(job.id, new FactsError(versions[0].unresolved).message); return undefined; }
  analysis.review = got.review;
  analysis.skim = versions.indexOf(kept) === 0 ? skimmed?.skim : undefined;
  analysis.map = { top: top.map((q) => ({ text: q.text, need: q.need, best: q.best ?? '', evidence: q.bestText || q.evidence })) };
  analysis.written = { sig: sigOf(kept.resume), repairs: kept.repaired.map((f) => `The writer changed a fact, and it was put back from your record. ${f.text}`) };
  db.query('UPDATE jobs SET resume = ?, analysis = ?, updated_at = ? WHERE id = ?').run(kept.resume, JSON.stringify(analysis), Date.now(), job.id);
  saveResume(job, kept.resume);
  await publish(job.id, print);
  return got.review;
}

// Makes a job's resume ready to send: its terms are counted again against the text as it now
// stands, every flag on it is taken again (lib/checks.ts), the PDF is printed and kept, and the file is
// read back as a parser would read it. Called after a job's resume is written and after the person edits
// it. Nothing here changes the resume's text. `print` is false where no browser should be started (tests).
export async function publish(jobId: number, print = true): Promise<void> {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null;
  if (!job || job.resume.trim() === '') return;
  const analysis: Analysis = job.analysis ? JSON.parse(job.analysis) : { ...EMPTY };
  const t = analysis.terms ?? { inResume: [], inBankOnly: [], missing: [] };
  analysis.terms = termsOf([...t.inResume, ...t.inBankOnly, ...t.missing], job.resume, bankText(), bankSkills());
  let ats = '', pdf = '', check: Awaited<ReturnType<typeof atsCheck>> | undefined;
  if (print) {
    try {
      const companies = (db.query("SELECT company FROM roles WHERE title != ''").all() as { company: string }[]).map((r) => r.company);
      const bytes = await renderPdf(job.resume, job.pages, companies);
      pdf = pdfPath(job, job.resume);
      await Bun.write(pdf, bytes);
      check = await atsCheck(bytes, job.resume, analysis.terms, job.pages, [...bankSkills()], companies);
      ats = JSON.stringify(check);
    } catch (e) { ats = JSON.stringify({ ok: false, pages: 0, lines: [{ label: 'PDF', ok: false, note: (e as Error).message }] }); }
  }
  // A flag must never stop a resume being saved or printed.
  try { analysis.flags = flags(job.resume, job.pages, { written: analysis.written, skim: analysis.skim, ats: check }); } catch (e) { console.log(`  flags for job ${jobId} failed: ${(e as Error).message}`); }
  db.query('UPDATE jobs SET analysis = ?, ats = ?, pdf = ? WHERE id = ?').run(JSON.stringify(analysis), ats, pdf, jobId);
}

// Takes a job's flags again without printing anything: for when the data a flag reads has changed (a role's
// dates, a skill's mark, an answered question) and the resume's text has not.
export function reflag(jobId: number): void {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null;
  if (!job || job.resume.trim() === '' || job.analysis === '') return;
  const analysis = JSON.parse(job.analysis) as Analysis;
  let check: { lines: { label: string; ok: boolean; note: string }[] } | undefined;
  try { check = job.ats ? JSON.parse(job.ats) : undefined; } catch { /* an unreadable check is left out */ }
  analysis.flags = flags(job.resume, job.pages, { written: analysis.written, skim: analysis.skim, ats: check });
  db.query('UPDATE jobs SET analysis = ? WHERE id = ?').run(JSON.stringify(analysis), jobId);
}
const openJobs = () => db.query("SELECT * FROM jobs WHERE resume != '' AND outcome = ''").all() as (JobRow & { edited: number; resume_status: string })[];
// The same for every job not yet sent. A job that fails is skipped: a flag must never stop the others.
export function reflagOpen(): void { for (const j of openJobs()) { try { reflag(j.id); } catch { /* skipped */ } } }

// After the person marks their skills: every resume not yet sent that a model wrote gets its Skills line written
// again from the list, with no model. A resume the person edited is left as it is. Returns the jobs whose
// resume changed, for the caller to print again.
export function refreshSkills(): number[] {
  const changed: number[] = [];
  for (const j of openJobs().filter((x) => x.edited === 0 && x.resume_status !== 'queued' && x.resume_status !== 'running')) {
    const resume = withSkills(j.resume, j.posting, j.pages);
    if (resume === j.resume) continue;
    const analysis: Analysis = j.analysis ? JSON.parse(j.analysis) : { ...EMPTY };
    // What was repaired when it was written still holds: only the Skills line changed.
    if (analysis.written?.sig === sigOf(j.resume)) analysis.written.sig = sigOf(resume);
    db.query('UPDATE jobs SET resume = ?, analysis = ? WHERE id = ?').run(resume, JSON.stringify(analysis), j.id);
    saveResume(j, resume);
    changed.push(j.id);
  }
  return changed;
}

// A new version could not be kept (FactsError), so the job's earlier resume stands. This says so on that resume, as a flag.
export function keepEarlier(jobId: number, why: string): void {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null;
  if (!job || job.resume.trim() === '' || job.analysis === '') return;
  const analysis = JSON.parse(job.analysis) as Analysis, sig = sigOf(job.resume);
  analysis.written = { sig, repairs: [...(analysis.written?.sig === sig ? analysis.written.repairs.filter((r) => r !== why) : []), why] };
  db.query('UPDATE jobs SET analysis = ? WHERE id = ?').run(JSON.stringify(analysis), jobId);
  reflag(jobId);
}

// The tailored resume is also kept as a file, named for the job.
export function saveResume(job: { id: number; company: string; title: string }, markdown: string): string {
  const dir = inData('resumes');
  mkdirSync(dir, { recursive: true });
  const slug = `${job.company} ${job.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'job';
  for (const old of readdirSync(dir).filter((f) => f.startsWith(`${job.id}-`))) rmSync(`${dir}/${old}`); // an earlier reading's file, perhaps under another name
  const file = `${dir}/${job.id}-${slug}.md`;
  writeFileSync(file, `${markdown}\n`);
  return file;
}
