// A job: one posting, measured against the bank. Reading it answers three things:
//   what the posting requires, and for each requirement what in the bank supports it;
//   a tailored resume built only from bank facts, ordered and worded for this posting;
//   how that resume differs from the one the person supplied, and what would close the gaps.
// The fit number is computed here from the requirement coverage, not asked of the model, so two
// jobs are ranked by the same arithmetic and each score can be explained row by row.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { db, type RoleRow } from './db.ts';
import { INBOX } from './ingest.ts';
import { ask } from './llm.ts';
import { council, type Review } from './council.ts';
import { ASKED } from './db.ts';
import { person, withHeader } from './person.ts';
import { BULLETS, SIGNAL, WRITING } from './writing.ts';
import { inData } from './paths.ts';
import { draftScore } from './ats.ts';
import { atsCheck, pdfPath, renderPdf } from './pdf.ts';
import { direction, directionForMaterials, fitTest } from './direction.ts';
import { TARGETS } from './profile.ts';

export type JobRow = { id: number; url: string; posting: string; title: string; company: string; place: string; status: string; note: string; fit: number; analysis: string; resume: string; created_at: number; updated_at: number; outcome: string; outcome_note: string; contact: string; ats: string; pdf: string; pages: number; posted_at: number; salary: string; applied_at: number };
// `roles` are the bank's role keys ("role:12") whose work supports the requirement; `weight` and `basis`
// are worked out here from those roles, never by the model.
export type Requirement = { text: string; need: 'must' | 'nice'; coverage: 'strong' | 'partial' | 'none'; evidence: string; roles?: string[]; weight?: number; basis?: string };
export type Knockout = { question: string; answer: 'yes' | 'no' | 'unknown'; note: string };
export type Terms = { inResume: string[]; inBankOnly: string[]; missing: string[] };
// The person's own fit test, answered for this posting: yes | partly | no | unknown.
export type Check = { question: string; answer: string; note: string };
export type Analysis = { verdict: string; requirements: Requirement[]; strengths: string[]; risks: string[]; changes: string[]; gaps: string[]; knockouts?: Knockout[]; terms?: Terms; checks?: Check[]; review?: Review };

const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['title', 'company', 'place', 'verdict', 'requirements', 'strengths', 'risks', 'resume', 'changes', 'gaps', 'terms', 'knockouts', 'checks'],
  properties: {
    title: { type: 'string' }, company: { type: 'string' }, place: { type: 'string' }, verdict: { type: 'string' },
    requirements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'need', 'coverage', 'evidence', 'roles'],
      properties: { text: { type: 'string' }, need: { type: 'string', enum: ['must', 'nice'] }, coverage: { type: 'string', enum: ['strong', 'partial', 'none'] }, evidence: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } } } } },
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

// Required things count three times a nice-to-have. Each requirement counts by its weight when it
// has one (weigh above), else by coverage alone: full for strong, half for partial. 0 to 100.
export function fitOf(requirements: Requirement[]): number {
  const need = (r: Requirement) => (r.need === 'must' ? 3 : 1);
  const total = requirements.reduce((n, r) => n + need(r), 0);
  if (total === 0) return 0;
  const got = requirements.reduce((n, r) => n + need(r) * (r.weight ?? (r.coverage === 'strong' ? 1 : r.coverage === 'partial' ? 0.5 : 0)), 0);
  return Math.round((got / total) * 100);
}

// Whether each of the posting's own terms appears, as written, in the resume: what a recruiter's
// keyword search or an applicant tracking system's match would find. A term the bank has but the
// resume lacks is a fixable miss; one the bank lacks is a real gap and is never added.
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

// `lean` leaves out each fact's story: the first reading judges coverage from the facts and their results alone, and is quicker for it.
function bank(lean = false) {
  const roles = db.query("SELECT * FROM roles ORDER BY CASE WHEN end = '' AND start != '' THEN 1 ELSE 0 END DESC, end DESC, start DESC").all() as RoleRow[];
  const facts = db.query('SELECT role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all() as { role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string }[];
  const of = (id: number | null) => facts.filter((f) => f.role_id === id).map(({ role_id: _r, ...f }) => (lean ? { ...f, detail: undefined } : f));
  const shape = (r: RoleRow) => ({ key: `role:${r.id}`, company: r.company, title: r.title, start: r.start, end: r.end || 'present', location: r.location,
    kind: STANDING_WORD[r.standing] ?? STANDING_WORD[''], reach: REACH_WORD[r.reach] ?? '', facts: of(r.id) });
  // A project filed under an employer is nested in it, so it reads as work done in that job.
  return { roles: roles.filter((r) => r.part_of === null || !roles.some((p) => p.id === r.part_of)).map((r) => ({ ...shape(r),
      projects: roles.filter((c) => c.part_of === r.id).map((c) => ({ ...shape(c), kind: undefined, reach: REACH_WORD[c.reach] || undefined })).filter((c) => c.facts.length > 0) }))
      .filter((r) => r.facts.length > 0 || r.projects.length > 0),
    general: [...of(null), ...facts.filter((f) => f.role_id !== null && !roles.some((r) => r.id === f.role_id)).map(({ role_id: _r, ...f }) => f)] };
}

const limits = (pages: number) => (pages === 1
  ? 'It must fit on ONE page when printed: at most 400 words in all, counting everything. The Summary is two sentences. A bullet is one sentence of at most 22 words. The two roles that matter most for this posting get up to four bullets each and one more gets two. Every other role is a single line of title, company and dates with no bullets. No Projects section. Skills is one line of at most fourteen items.'
  : 'It must fit on two pages when printed: 700 to 850 words in all, never under 660. A bullet is one sentence of at most 28 words. The two most recent or most relevant roles get up to five bullets, the next up to three, and anything older one or two, or a single line.');

// The whole instruction for reading a posting. `withResume` leaves out the two items that write the
// resume, for the first, fast reading that only says where the person stands.
function reading(posting: string, pages: number, resume: string | undefined, withResume: boolean, lean = false): string {
  return `You are measuring one job posting against one person's knowledge bank, and writing the resume they should send for it.

The bank is everything you know about the person. Never invent, round up or infer a number, title, date, technology or outcome. If the bank does not show something, the person does not have it for this purpose.

1. Read the posting. "title", "company" and "place" (location or "Remote", "" if unsaid) come from it.

2. "requirements": every distinct thing the posting asks for, in the posting's order, each in a short phrase close to the posting's wording. Split compound lines. Skip boilerplate (benefits, equal opportunity text).
   - "need" is "must" for what the posting requires or clearly centres on, and "nice" for what it calls preferred, a plus or a bonus.
   - "coverage" is "strong" when the bank has specific work that directly shows it, "partial" when the bank shows something adjacent, shorter or smaller than asked, and "none" when the bank shows nothing.
   - "roles" lists the keys ("role:12") of the bank roles or projects whose work supports it, strongest first, at most four; [] when coverage is "none" or the support is general (education, a skills list).
   - "evidence" names the work that supports it in one sentence ("Led five engineers on the billing export at Acme, 2021 to now"), or says what is missing when coverage is "none". Be strict: years of experience are counted from role dates; a technology counts only where the bank shows it used.

3. "verdict": three or four plain sentences to the person: how well they fit, what carries the application, what is most likely to get it screened out, and whether it is worth applying.
   "strengths": up to five, the points a recruiter for this job would care most about, each tied to named work.
   "risks": up to five, the gaps or mismatches a screener would notice, most serious first. List one only if a screener at this company would plausibly hold it against the application. Where the person works from (remote, hybrid, an office) is a risk only when the bank shows they cannot or will not do what the posting needs. A requirement the bank answers directly (work authorisation, travel, being on site) is not a risk. Being the only engineer who builds for a company's departments counts as working with customers and their teams.
${withResume ? `
4. "resume": the resume to send for this posting, as Markdown, built only from the bank.
   - First line "# " and the person's name${person().name ? ` ("${person().name}")` : ' if the bank or the supplied resume gives it'}, then one line of contact details. That line is written over afterwards from the person's own details, so do not spend effort on it.
   - "## Summary": two or three sentences aimed at this posting, using its vocabulary where the bank honestly supports it.
   - A recruiter's first pass takes seconds and lands on the name, the current title, the most recent employer and its dates, so those must be plain and near the top.
   - A role's "projects" are repositories of work done in that job: write them as part of that role's bullets, under that employer, never as separate entries or personal projects. Their keys ("role:15") are valid in a requirement's "roles".
   - Each role in the bank carries a "kind" (employer, own company, contract, personal project, or not set) and a "reach" (in production, was in production, never reached users). Lead with paid and production work. Personal projects go under "## Projects" after Experience, at most three, and only where they show something the posting asks for that the paid work does not.
   - "## Experience": roles newest first as "### Title, Company" with a line of dates and location. Under each, three to six bullets chosen and ordered for this posting: the work that answers its requirements first, in the form action, what it was for, result. A number you show is exactly as the bank has it, and the rules below say which to show. Leave out work that does not help this application; older or unrelated roles may be one line.
   - "## Skills": only skills the bank shows, the posting's first.
   - "## Education" when the bank has it.
   - ${limits(pages)}
   - No tables, columns, images or icons, and only these section names, so applicant tracking systems read it cleanly: Summary, Experience, Projects, Skills, Education.
   - Write dates as "Mar 2021 – Present" on the line under each role's heading, with the place after a middle dot.

5. "changes": ${resume ? `read the resume the person supplied, the file "./${resume}" in the current directory, and list up to eight specific differences between it and the resume you wrote, each with its reason: what was added from the bank that the supplied resume lacks, what was cut or shortened, what was reordered or reworded for this posting.` : 'the person supplied no resume file, so return an empty list.'}
` : ''}
6. "terms": the posting's hard keywords exactly as it writes them, up to thirty: technologies, tools, methods, domain terms and the job title. These are what a recruiter searches for and what an applicant tracking system matches. No soft phrases ("team player").
   Use each of these terms in the resume, in the posting's spelling, wherever the bank honestly supports it. Never add one the bank does not support.

7. "knockouts": the yes-or-no screening questions this posting is likely to ask on its application form (work authorisation, location or time zone, minimum years, a required degree or clearance, willingness to travel or be on site), each with the answer the bank supports ("yes", "no", or "unknown" when the bank does not say) and a short note. Up to six; [] if the posting implies none.

8. "gaps": up to six questions the person could answer from memory that would most raise their fit for this posting, each naming the requirement it would support. Only ask about things they plausibly did.${ASKED()}

${person().location ? `   The person lives in ${person().location}. Use that for any question about location, time zone or being on site.\n\n` : ''}9. "checks": ${fitTest().length ? `the person's own fit test for a listing. Answer each question for this posting from what the posting says ("yes", "partly", "no", or "unknown" when it does not say, as with pay it does not state), with a one-sentence note naming what in the posting decides it. The questions, to be returned word for word:\n${fitTest().map((q) => `   - ${q}`).join('\n')}` : 'return [].'}
   The verdict should take these into account alongside the requirements: a posting that matches skills but fails the person's own test is a weaker choice, and say so.

${SIGNAL}

${WRITING}

${BULLETS}

The person is looking for these kinds of role: ${TARGETS.list.join('; ')}.
${directionForMaterials() ? `\nTheir own notes on their direction follow. In the resume, follow what they say about order and emphasis (for instance leading each role with leadership, a scope line under a title, including earlier work they value at the weight they give it). The notes do not add facts: every line still needs the bank.\n<direction>\n${directionForMaterials()}\n</direction>\n` : ''}${direction() && direction() !== directionForMaterials() ? '\nPart of their notes is a personal lens they use to think about fit. It is not shown to you and must never appear in the resume.\n' : ''}

The posting:
<posting>
${posting.slice(0, 60_000)}
</posting>

The bank, as JSON:
${JSON.stringify(bank(lean))}`;
}

const READ_SCHEMA = { ...SCHEMA, required: SCHEMA.required.filter((k) => k !== 'resume' && k !== 'changes'),
  properties: Object.fromEntries(Object.entries(SCHEMA.properties).filter(([k]) => k !== 'resume' && k !== 'changes')) };
const WRITE_SCHEMA = { type: 'object', additionalProperties: false, required: ['resume', 'changes'], properties: { resume: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } } };
type Read = { title: string; company: string; place: string; terms: string[]; knockouts: Knockout[]; checks: Check[] } & Omit<Analysis, 'terms' | 'knockouts' | 'checks' | 'changes' | 'review'>;

// The first reading: what the posting asks, how the bank covers each thing, and so the fit. Quick, so the
// person sees where they stand in under a minute. Measured 2026-11-11 on one posting: Sonnet at low effort
// took 37 s and wrote 6K tokens; Haiku took 90 s and wrote 21K, at any effort. EGG_READ_MODEL changes it. `resume` is the
// resume the job already has, if any, so its keyword count stays right until a new one is written.
export async function assess(posting: string, resume = ''): Promise<{ title: string; company: string; place: string; analysis: Analysis; fit: number; terms: string[] }> {
  if ((db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n === 0) throw new Error('The bank is empty. Add a source first.');
  const r = await ask<Read>({ cwd: INBOX, schema: READ_SCHEMA, timeoutMs: 10 * 60_000, model: process.env.EGG_READ_MODEL ?? 'sonnet', effort: 'low',
    prompt: reading(posting, 2, undefined, false, true).replace("You are measuring one job posting against one person's knowledge bank, and writing the resume they should send for it.", "You are measuring one job posting against one person's knowledge bank, so they can see where they stand. The resume is written afterwards, separately.") });
  const requirements = weigh(r.requirements, db.query('SELECT * FROM roles').all() as RoleRow[], Date.now());
  const analysis: Analysis = { verdict: r.verdict.trim(), requirements, strengths: r.strengths, risks: r.risks, changes: [], gaps: r.gaps,
    knockouts: r.knockouts, terms: termsOf(r.terms, resume, bankText(), bankSkills()), checks: r.checks };
  return { title: r.title.trim(), company: r.company.trim(), place: r.place.trim(), analysis, fit: fitOf(requirements), terms: r.terms };
}

// The second step, in the background: the resume for the posting, then the council's review of it.
// Set EGG_COUNCIL=off to skip the review (a quick run, or a test).
export async function compose(posting: string, pages: number, terms: string[]): Promise<{ resume: string; changes: string[]; review?: Review; terms: Terms }> {
  const supplied = suppliedResume();
  const r = await ask<{ resume: string; changes: string[] }>({ cwd: INBOX, schema: WRITE_SCHEMA, tools: supplied ? ['Read'] : [], allow: supplied ? ['Read'] : [],
    timeoutMs: 25 * 60_000, model: process.env.EGG_JOB_MODEL ?? process.env.EGG_MODEL ?? 'opus',
    prompt: `${reading(posting, pages, supplied, true)}

The posting has already been read and scored. Return only "resume" (item 4) and "changes" (item 5). The other items are here so you read the posting the same way. Its terms, as found then, are: ${terms.join(', ') || 'none found'}.` });
  const draft = withHeader(r.resume.trim()), words = bankText(), skills = bankSkills();
  const reviewed = process.env.EGG_COUNCIL === 'off' ? { resume: draft, review: undefined } : await council(draft, posting, JSON.stringify(bank()), limits(pages), INBOX, (l) => console.log(`  ${l}`), directionForMaterials(),
    // Scored as it will be sent: with its header, and with the bank's own terms it left out added to Skills.
    (text) => { const t = termsOf(terms, text, words, skills), sent = withTerms(withHeader(text), t.inBankOnly); return draftScore(sent, [...t.inResume, ...t.inBankOnly], pages, [...skills]); });
  // Terms the bank supports but the resume left out go into Skills, then the count is taken again.
  const resume = withTerms(withHeader(reviewed.resume), termsOf(terms, reviewed.resume, words, skills).inBankOnly);
  return { resume, changes: r.changes, review: reviewed.review, terms: termsOf(terms, resume, words, skills) };
}

// Both steps, one after the other: for the tools that read every job again.
export async function analyze(posting: string, pages = 2): Promise<{ title: string; company: string; place: string; resume: string; analysis: Analysis; fit: number }> {
  const a = await assess(posting), c = await compose(posting, pages, a.terms);
  return { title: a.title, company: a.company, place: a.place, resume: c.resume, analysis: { ...a.analysis, changes: c.changes, review: c.review, terms: c.terms }, fit: a.fit };
}

// A posting's term that the bank supports but the resume left out is added to the Skills section:
// the one change made to a resume without a model, and only ever with words the bank already holds.
export function withTerms(resume: string, add: string[]): string {
  if (add.length === 0) return resume;
  const lines = resume.split('\n'), at = lines.findIndex((l) => /^##\s+Skills\b/i.test(l));
  if (at < 0) return `${resume.trimEnd()}\n\n## Skills\n\n${add.join(', ')}\n`;
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let last = end - 1;
  while (last > at && lines[last].trim() === '') last--;
  if (last > at && !/^\s*[-*]\s/.test(lines[last])) lines[last] = `${lines[last].replace(/[.\s]+$/, '')}, ${add.join(', ')}`;
  else lines.splice(last + 1, 0, /^\s*[-*]\s/.test(lines[last] ?? '') ? `- Also: ${add.join(', ')}` : add.join(', '));
  return lines.join('\n');
}

export const bankSkills = () => new Set((db.query('SELECT skills FROM facts').all() as { skills: string }[]).flatMap((f) => f.skills.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)));
const bankText = () => (db.query('SELECT text, detail, metric, skills FROM facts').all() as Record<string, string>[]).map((f) => Object.values(f).join(' ')).join(' ');

// The council alone, for a resume already written: reviewed, rewritten if it falls short, saved and
// printed again. The fit and the reading of the posting are left as they were.
export async function review(job: JobRow, print = true): Promise<Review> {
  const got = await council(withHeader(job.resume), job.posting, JSON.stringify(bank()), limits(job.pages), INBOX, (l) => console.log(`  ${l}`), directionForMaterials());
  const analysis: Analysis = job.analysis ? JSON.parse(job.analysis) : { verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] };
  analysis.review = got.review;
  const resume = withHeader(got.resume);
  db.query('UPDATE jobs SET resume = ?, analysis = ?, updated_at = ? WHERE id = ?').run(resume, JSON.stringify(analysis), Date.now(), job.id);
  saveResume(job, resume);
  await publish(job.id, print);
  return got.review;
}

// Makes a job's resume ready to send: its terms are counted again against the text as it now
// stands, the PDF is printed and kept, and the file is read back as a parser would read it.
// Called after a job is read and after the person edits its resume. `print` is false where no
// browser should be started (tests).
export async function publish(jobId: number, print = true): Promise<void> {
  const job = db.query('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | null;
  if (!job || job.resume.trim() === '') return;
  const analysis: Analysis = job.analysis ? JSON.parse(job.analysis) : { verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] };
  const t = analysis.terms ?? { inResume: [], inBankOnly: [], missing: [] };
  analysis.terms = termsOf([...t.inResume, ...t.inBankOnly, ...t.missing], job.resume, bankText(), bankSkills());
  let ats = '', pdf = '';
  if (print) {
    try {
      const bytes = await renderPdf(job.resume, job.pages, (db.query("SELECT company FROM roles WHERE title != ''").all() as { company: string }[]).map((r) => r.company));
      pdf = pdfPath(job, job.resume);
      await Bun.write(pdf, bytes);
      ats = JSON.stringify(await atsCheck(bytes, job.resume, analysis.terms, job.pages, [...bankSkills()]));
    } catch (e) { ats = JSON.stringify({ ok: false, pages: 0, lines: [{ label: 'PDF', ok: false, note: (e as Error).message }] }); }
  }
  db.query('UPDATE jobs SET analysis = ?, ats = ?, pdf = ? WHERE id = ?').run(JSON.stringify(analysis), ats, pdf, jobId);
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
