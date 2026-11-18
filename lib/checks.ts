// What code can say about one resume and about the person's data, with no model:
// - `flags`: everything about a resume the person should look at, in plain words. It is taken again every time
//   a resume is written or edited by hand (publish in lib/jobs.ts) and kept in the job's analysis.
// - `syncQuestions`: brings the questions code raises for the person (lib/raised.ts) in step with the data: the
//   timeline, the LinkedIn differences, and skills not yet marked.
// A flag never changes a resume. What code repairs in a resume a model wrote is done before this (lib/entries.ts).
import { bullets } from './ats.ts';
import { db, type RoleRow } from './db.ts';
import { checkEntries, emptyEntries, employers, normCompany, type ProjectName } from './entries.ts';
import { syncLinkedin } from './linkedin.ts';
import { inventory, kept, type FactLite } from './metrics.ts';
import { NUMBER_TOKEN, redact, unsupported } from './numbers.ts';
import { keptLines } from './record.ts';
import { onAnswer, openRaised, raise, type Raised } from './raised.ts';
import { parseResume, sentences, skimView, STANDARD, wordCount, type Resume } from './resume.ts';
import type { Skim } from './skim.ts';
import { allSkills, skillProblems, syncSkills } from './skills.ts';
import { timeline, type Action, type Finding } from './timeline.ts';

// high: a fact on the page disagrees with the bank. warn: a rule is broken. info: worth knowing.
export type Flag = { kind: string; severity: 'high' | 'warn' | 'info'; text: string; items?: string[] };
// What was done to a resume when it was written, kept with the text it applies to (`sig`).
export type Written = { sig: string; repairs: string[] };

// The summary may run a little past "about 50 words" before it is flagged.
export const SUMMARY_WORDS = 60, SUMMARY_SENTENCES = 3;
// A job that ended this many years ago, or more, is an old one (rule 8).
export const OLD_YEARS = 8;

export const sigOf = (text: string) => new Bun.CryptoHasher('sha256').update(text.trim()).digest('hex').slice(0, 16);
const allRoles = () => db.query('SELECT * FROM roles').all() as RoleRow[];
const metricFacts = () => db.query("SELECT id, role_id, metric FROM facts WHERE metric != '' ORDER BY id").all() as FactLite[];
const list = (xs: string[], most = 6) => `${xs.slice(0, most).join('; ')}${xs.length > most ? `; and ${xs.length - most} more` : ''}`;

// The timeline findings that touch a job this resume shows.
function shownFindings(resume: Resume, roles: RoleRow[], now: number): Finding[] {
  const shown = new Set([...resume.experience.map((e) => e.company || e.title), ...resume.earlier.map((e) => e.company || e.title)].map(normCompany));
  const ids = new Set(employers(roles).filter((g) => g.rows.some((r) => shown.has(normCompany(r.company)))).flatMap((g) => g.rows.map((r) => r.id)));
  return timeline(roles, now).filter((f) => f.question && f.roles.some((id) => ids.has(id)));
}

// What the rules find in the resume's own text, measured against the bank. The same for a written and an edited resume.
export function codeFlags(markdown: string, pages: number, now = Date.now(), context: FlagContext = flagContext()): Flag[] {
  const roles = allRoles(), resume = parseResume(markdown, roles.map((r) => r.company)), out: Flag[] = [];
  // A dated line that is no entry may be a job the bank lacks, or a certificate: it is a warning, not a fact that is wrong.
  // A project written as an entry or a heading with dates of its own is its own kind: the writer can put it right.
  for (const f of checkEntries(markdown, roles, context.names)) out.push({ kind: f.project ? 'project-heading' : 'facts', severity: f.loose ? 'warn' : 'high', text: f.text });
  for (const heading of emptyEntries(resume)) out.push({ kind: 'zero-bullets', severity: 'warn', text: `“${heading}” has no bullets under it. Give it a bullet, or name it on the Earlier experience line instead.` });
  const k = kept(resume, inventory(metricFacts()), roles);
  if (k.dropped.length > 0) out.push({ kind: 'metrics-dropped', severity: 'warn', items: k.dropped.map((m) => m.text),
    text: `This resume shows ${k.held.length} of the ${k.master.length} measured results your record holds for the jobs it gives bullets to. Left out: ${list(k.dropped.map((m) => m.text))}.` });
  if (k.summaryOnly.length > 0) out.push({ kind: 'summary-metric', severity: 'warn', items: k.summaryOnly.map((m) => m.text),
    text: `The summary uses a result that is not in the bullets of the job it came from: ${list(k.summaryOnly.map((m) => m.text))}. Put it in that job’s bullets too.` });
  // Rule 8: a job that ended 8 or more years ago gets one bullet at most. (Whether a job is outside the posting's field is the writer's call.)
  for (const g of employers(roles)) {
    const entry = resume.experience.find((e) => g.rows.some((r) => normCompany(r.company) === normCompany(e.company || e.title)));
    const ends = g.rows.filter((r) => r.start !== '').map((r) => r.end);
    if (!entry || entry.bullets.length <= 1 || ends.length === 0 || ends.includes('')) continue;
    const [y, m] = ends.sort().pop()!.split('-').map(Number), years = (now - new Date(y, (m || 12) - 1, 28).getTime()) / (365.25 * 86_400_000);
    if (years >= OLD_YEARS) out.push({ kind: 'old-role', severity: 'warn', text: `“${entry.heading}” ended ${Math.floor(years)} years ago and has ${entry.bullets.length} bullets. A job that old gets one bullet at most, or a place on the Earlier experience line.` });
  }
  const n = sentences(resume.summary).length, words = wordCount(resume.summary);
  if (n > SUMMARY_SENTENCES || words > SUMMARY_WORDS) out.push({ kind: 'summary-long', severity: 'warn', text: `The summary runs to ${n} ${n === 1 ? 'sentence' : 'sentences'} and ${words} words. The limit is 3 sentences and about 50 words.` });
  const first = resume.name.split(/\s+/)[0] ?? '';
  if (/\b(?:he|she|his|her|him)\b/i.test(resume.summary) || (first.length > 1 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(resume.summary))) out.push({ kind: 'summary-person', severity: 'warn', text: 'The summary speaks of you in the third person. Write it with the subject left out (“Engineer with 12 years…”).' });
  const odd = resume.sections.filter((s) => !STANDARD.some((x) => x.toLowerCase() === s.toLowerCase()));
  if (odd.length > 0) out.push({ kind: 'headings', severity: 'warn', text: `${odd.length === 1 ? 'The section' : 'The sections'} ${odd.map((s) => `“${s}”`).join(', ')} ${odd.length === 1 ? 'is' : 'are'} not among the standard headings a parser expects: Summary, Experience, Skills, Education.` });
  const skills = skillProblems(resume.skills, pages);
  if (skills.over > 0) out.push({ kind: 'skills-cap', severity: 'warn', text: `Skills lists ${resume.skills.length} items. The most for this length is ${skills.cap}.` });
  if (skills.notAllowed.length > 0) out.push({ kind: 'skills-other', severity: 'warn', items: skills.notAllowed, text: `Skills lists items that are not on your skills list as a tool, language or platform you are confident in: ${list(skills.notAllowed, 8)}.` });
  if (skills.unconfirmed) out.push({ kind: 'skills-unconfirmed', severity: 'info', text: 'You have not reviewed your skills list yet, so this resume may name a skill you would not defend in an interview. Review the list once and this goes away.' });
  const tense = bullets(markdown).flags.filter((f) => /tense/.test(f.why));
  if (tense.length > 0) out.push({ kind: 'tense', severity: 'info', items: tense.map((f) => f.quote), text: `${tense.length} ${tense.length === 1 ? 'bullet opens' : 'bullets open'} in the wrong tense for the job: the present tense is for your current job, the past tense for the others.` });
  // The finding stays a flag for as long as the data shows it, also after the person answered its question.
  const waiting = new Set(openRaised().map((q) => q.key));
  for (const f of shownFindings(resume, roles, now)) out.push({ kind: 'timeline', severity: 'warn', text: `${f.text} ${waiting.has(f.key) ? 'A question about it is waiting for you.' : 'Give the job an end date, a label or a one-line note to settle it.'}` });
  out.push(...contextFlags(resume, roles, context));
  return out;
}

// Rule 9, a number is never invented, now that a writer is given context beside the facts: a project's name and parts
// (lib/jobs.ts, bank) and the kept lines of "How you work" (brief). The numbers no fact holds are taken out of what the
// writer is given ("[number]", lib/numbers.ts, redact), so this check is the simple one:
// - `context-number`: a number in a bullet whose value stands in the context as stored (the name and parts of every
//   project of a role in the record) and in no fact of the bullet's employer, with its story, metric, number before,
//   team, own part and skills. In the summary any fact counts, and a count of years is left to the role dates. Only the
//   value is compared (lib/numbers.ts, unsupported), so a flagged number is one no such fact holds in any form.
// - `number-mark`: a resume that prints "[number]".
// - `kept-line`: a bullet or summary that copies a kept line; one that says it in other words is not caught.
// A number in neither the context nor the facts is not judged here.
export type FlagContext = { context: string; names: ProjectName[]; lines: { key: string; text: string }[];
  facts: { role_id: number | null; text: string; detail: string; metric: string; baseline: string; team: string; own_part: string; skills: string }[]; versions: string[] };
// What these checks read from the record, read once: reflagOpen and compose take it once for every resume they check.
export function flagContext(): FlagContext {
  const projects = db.query("SELECT title, situation, did, result FROM projects WHERE via_role IS NULL AND role_id IS NOT NULL").all() as { title: string; situation: string; did: string; result: string }[];
  const context = projects.map((p) => [p.title, p.situation, p.did, p.result].join(' ')).join(' ');
  const lines = keptLines();
  const names = projectNames();
  if (context.trim() === '' && lines.length === 0) return { context: '', names, lines, facts: [], versions: [] };
  const facts = db.query('SELECT role_id, text, detail, metric, baseline, team, own_part, skills FROM facts').all() as FlagContext['facts'];
  return { context, names, lines, facts, versions: versionNames() };
}
// The record's projects of roles by name, with their role in words, for lib/entries.ts to name a project written as a
// heading (it reads no database itself).
export const projectNames = (): ProjectName[] => (db.query("SELECT p.title, r.title AS rtitle, r.company FROM projects p JOIN roles r ON r.id = p.role_id WHERE p.via_role IS NULL AND p.title != ''").all() as { title: string; rtitle: string; company: string }[])
  .map((p) => ({ name: p.title.trim(), role: p.rtitle ? `${p.rtitle} at ${p.company}` : p.company }));
// The person's tools, languages and platforms by name: a version-shaped number right after one is no count ("Node 20").
export const versionNames = () => allSkills().filter((x) => x.kind !== 'other').map((x) => x.name);
const plainWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const MARK_TEXT = (where: string) => `${where} prints “${NUMBER_TOKEN}”, which marks a number left out of what the writer was given because no fact holds it. Write it without the mark, or with a number a fact states.`;
function contextFlags(resume: Resume, roles: RoleRow[], c: FlagContext): Flag[] {
  const out: Flag[] = [];
  const check = (where: string, text: string, ids: Set<number> | null, summary: boolean) => {
    if (text.includes(NUMBER_TOKEN)) out.push({ kind: 'number-mark', severity: 'high', text: MARK_TEXT(where) });
    if (c.context === '' && c.lines.length === 0) return;
    const stated = c.facts.filter((f) => ids === null || (f.role_id !== null && ids.has(f.role_id))).map((f) => [f.text, f.detail, f.metric, f.baseline, f.team, f.own_part, f.skills].join(' ')).join(' ');
    const only = c.context === '' ? [] : unsupported(text, c.context, stated, { versions: c.versions });
    if (only.length > 0) out.push({ kind: 'context-number', severity: 'high', items: only,
      text: `${where} uses ${andList(only)}, which your record has only in a project’s background, not in a fact. Take ${only.length === 1 ? 'it' : 'them'} out, or use a number a fact states.` });
    for (const l of c.lines.filter((x) => [x.text, redact(x.text)].some((t) => plainWords(text).includes(plainWords(t))))) out.push({ kind: 'kept-line', severity: 'warn', items: [l.text],
      text: `${where} repeats a line of How you work: “${l.text}” Those lines help choose what leads, and are not facts to print. Take it out.` });
  };
  if (resume.summary.trim() !== '') check('The summary', resume.summary, null, true);
  const groups = employers(roles);
  for (const e of resume.experience) {
    const g = groups.find((x) => x.rows.some((r) => normCompany(r.company) === normCompany(e.company || e.title)));
    const ids = g ? new Set([...g.rows, ...g.children].map((r) => r.id)) : null;
    for (const b of e.bullets) check(`“${b}”`, b, ids, false);
  }
  return out;
}
// The code findings a rewrite can put right, as instructions for the writer (lib/skim.ts).
export const fixable = (markdown: string, pages: number, context?: FlagContext): string[] => codeFlags(markdown, pages, Date.now(), context).filter((f) => ['summary-long', 'summary-person', 'summary-metric', 'old-role', 'context-number', 'kept-line', 'project-heading', 'number-mark'].includes(f.kind)).map((f) => f.text);

// Every flag for a job's resume as it stands: the code findings, what was repaired when it was written, what the
// skim found, and what the parse test of the PDF found. Repairs and the skim are shown only while the text they
// were made on is still the text.
export function flags(markdown: string, pages: number, about: { written?: Written; skim?: Skim; ats?: { lines: { label: string; ok: boolean; note: string }[] } } = {}, now = Date.now(), context?: FlagContext): Flag[] {
  const out = codeFlags(markdown, pages, now, context);
  if (about.written && about.written.sig === sigOf(markdown)) for (const r of about.written.repairs) out.push({ kind: 'facts-repaired', severity: 'info', text: r });
  if (about.skim) {
    if (about.skim.saw !== skimView(parseResume(markdown))) out.push({ kind: 'skim-stale', severity: 'info', text: 'The top of this resume changed after its six-second skim, so what the skim found is not shown. Write the resume again to have it skimmed.' });
    else {
      for (const t of about.skim.top.filter((x) => !x.answered)) out.push({ kind: 'top-requirement', severity: 'warn', text: `A reader who stops after your summary and first job does not see an answer to “${t.requirement}”, one of this posting’s top three requirements.${t.note ? ` ${t.note}` : ''}` });
      for (const o of about.skim.open.filter((x) => !/does not answer this requirement/.test(x))) out.push({ kind: 'skim-open', severity: 'warn', text: o });
      for (const q of about.skim.questions) out.push({ kind: 'skim-question', severity: 'info', text: `A six-second skim raises a question only you can answer: ${q}` });
    }
  }
  for (const l of (about.ats?.lines ?? []).filter((x) => !x.ok && ['Text reads back', 'Reading order', 'Standard sections', 'Characters'].includes(x.label))) out.push({ kind: 'parse', severity: 'high', text: `Parse test of the PDF, ${l.label.toLowerCase()}: ${l.note}` });
  return out;
}

// Brings every code-raised question in step with the data as it now is. Cheap, and safe to call often.
export function syncQuestions(now: number): void {
  syncSkills(now);
  raise('timeline', timeline(allRoles(), now).filter((f) => f.question).map((f) => ({ key: f.key, text: f.question!.text, choices: f.question!.choices, about: f.roles.map((id) => `role:${id}`).join(','), data: { actions: f.question!.actions } })), now);
  syncLinkedin(now);
}

// A timeline answer changes the role it names: a label as chosen, or the end date or note the person gives with it.
onAnswer('timeline', (q: Raised, choice: number, value: string) => {
  const act = ((q.data.actions as Action[] | undefined) ?? [])[choice];
  if (!act || act.field === 'none') return '';
  const v = (act as { value?: string }).value ?? value.trim();
  if (act.field === 'end' && !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v)) return 'Give the end date as a year and a month, like 2023-06.';
  // The same rule as PATCH /roles/:id: a job cannot end before it starts.
  if (act.field === 'end') { const start = (db.query('SELECT start FROM roles WHERE id = ?').get(act.role as number) as { start: string } | null)?.start ?? ''; if (start !== '' && v < start.slice(0, v.length)) return 'That end date is before the job’s start date.'; }
  if (act.field === 'note' && (v === '' || v.length > 200 || v.includes('\n'))) return 'Write one line, of at most 200 characters, that says how the two relate.';
  for (const id of [act.role].flat()) db.query(`UPDATE roles SET "${act.field}" = ? WHERE id = ?`).run(v, id);
  return '';
});
