// The agenda: what the saved postings say to ask the owner next (raised kind `agenda`, lib/raised.ts). Pure code, no
// model. Each finding becomes one stored question that asks for more story; the owner answers it in their own words on
// the You screen (lib/nextquestion.ts), and those words go to Talk, where the bank learns from them. An answered or
// skipped question stays answered (raise leaves answered ones alone).
//
// Two kinds of finding:
// 1. agenda:term:<term>  A posting's own keyword that its reading found nothing for (unmetIn), in at least MIN_JOBS of
//    the jobs not yet sent, and that no fact in the record names. One question per term, the term asked by the most
//    postings first; at most TERMS_OPEN open at once.
// 2. agenda:lean:<project> The last resumes take at least half of their linked bullets from one project, and at least
//    MIN_RESUMES of them use it. At most one open.
// Every number in a question's words is counted here from stored rows: postings, resumes and lines.
import { db, norm, type RoleRow } from './db.ts';
import { parseLinks } from './links.ts';
import { raise, type Finding } from './raised.ts';
import { placeOf, tree, type ProjectRow } from './tree.ts';

export const MIN_JOBS = 2, TERMS_OPEN = 3, LAST_RESUMES = 6, MIN_RESUMES = 3;

// A job not yet sent, with its reading: analysis is the stored JSON (lib/jobs.ts, Analysis), termsRaw the posting's
// keywords as first read (jobs.terms_raw, a JSON list).
export type AgendaJob = { id: number; analysis: string; termsRaw: string };
// A written resume's links (jobs.links, lib/links.ts), newest first.
export type AgendaResume = { id: number; links: string };
export type AgendaInput = {
  jobs: AgendaJob[]; resumes: AgendaResume[];
  // The project each fact in the record sits in, as the tree places it (lib/tree.ts); null for none.
  projectOf: Map<number, number | null>;
  // Each project's name, as the tree shows it.
  titles: Map<number, string>;
  // Each fact's words: its text, story and skills.
  facts: string[];
  answered: Set<string>;
};
export type AgendaData = { kind: 'term'; term: string; jobs: number[]; count: number } | { kind: 'lean'; project: number; count: number; total: number; resumes: number; jobs: number[] };
export type AgendaFinding = Finding & { data: AgendaData };

type Req = { text?: string; need?: string; coverage?: string };
type Read = { requirements?: Req[]; terms?: { inResume?: string[]; inBankOnly?: string[]; missing?: string[] } };
const parse = <T>(s: string, empty: T): T => { try { return (JSON.parse(s) as T) ?? empty; } catch { return empty; } };

// A term this short is often an ordinary word or a letter ("Go", "R", "C", "Swift"), so it matches only in the
// posting's own spelling, case and all.
export const SHORT_TERM = 5;
const isShort = (term: string) => term.length <= SHORT_TERM;
const LETTER = /[\p{L}\p{N}_]/u;
// Characters that join a term to the words beside it: "go-to", "R&D", "C-level", "Objective-C", "C++", "C#", "Go/Rust".
// A full stop joins only between two word characters ("Node.js", "ASP.NET"); one that ends a sentence does not.
const JOIN = /[-&+#/]/;
const joinedBefore = (text: string, at: number) => { const c = text[at - 1] ?? ''; return c === '.' ? LETTER.test(text[at - 2] ?? '') : LETTER.test(c) || JOIN.test(c); };
const joinedAfter = (text: string, end: number) => { const c = text[end] ?? ''; return c === '.' ? LETTER.test(text[end + 1] ?? '') : LETTER.test(c) || JOIN.test(c); };

// Whether a posting's term stands in a text on its own: not inside a longer word, and not joined to one. A term of
// SHORT_TERM characters or fewer matches only as the posting spells it; a longer one in any case. The term itself may
// hold the joining characters ("C++", "C#", ".NET", "A/B testing"). Stricter than termsOf in lib/jobs.ts, which looks
// for a term in a resume and (for a term of three characters or fewer) in the skills list: a question here says the
// record has nothing for the term, so a loose match would ask the wrong thing.
export function hasTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (t === '') return false;
  const hay = isShort(t) ? text : text.toLowerCase(), needle = isShort(t) ? t : t.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!joinedBefore(hay, at) && !joinedAfter(hay, at + needle.length)) return true;
  }
  return false;
}
// Two spellings of one term: the same case for a short term, any case for a longer one.
const sameTerm = (a: string, b: string) => (isShort(a.trim()) || isShort(b.trim()) ? a.trim() === b.trim() : norm(a) === norm(b));
const termKey = (term: string) => (isShort(term) ? term : norm(term));

// A posting's own keywords: as first read, else (a reading kept before the raw list) the three lists of its reading.
function termsOf(job: AgendaJob, a: Read): string[] {
  const raw = parse<unknown>(job.termsRaw || '[]', []);
  const list = Array.isArray(raw) && raw.length > 0 ? raw : [...(a.terms?.inResume ?? []), ...(a.terms?.inBankOnly ?? []), ...(a.terms?.missing ?? [])];
  return list.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
}

// Whether one job asks for a term that its reading found nothing for. All must hold:
// - the term is in a requirement the job must have (or plainly implies) whose coverage is none;
// - no requirement of the same job that names the term has strong or partial coverage;
// - where the reading kept its term lists (Analysis.terms in lib/jobs.ts), the term is among the missing and neither in
//   the resume nor in the bank.
export function unmetIn(a: Read, term: string): boolean {
  const reqs = (a.requirements ?? []).filter((r) => typeof r.text === 'string' && hasTerm(r.text, term));
  if (!reqs.some((r) => (r.need === 'must' || r.need === 'implied') && r.coverage === 'none')) return false;
  if (reqs.some((r) => r.coverage === 'strong' || r.coverage === 'partial')) return false;
  const lists = a.terms;
  if (lists && typeof lists === 'object' && [lists.inResume, lists.inBankOnly, lists.missing].some(Array.isArray)) {
    const inList = (l: unknown) => Array.isArray(l) && l.some((x) => typeof x === 'string' && sameTerm(x, term));
    if (!inList(lists.missing) || inList(lists.inResume) || inList(lists.inBankOnly)) return false;
  }
  return true;
}

// 1. The posting terms that more than one unsent job asks for and the record shows nothing for. `facts` is each fact's
// words (its text, story and skills): a term any of them names is in the record, so it is not asked about.
export function termFindings(jobs: AgendaJob[], answered: Set<string>, facts: string[] = []): AgendaFinding[] {
  // By term: the first spelling met (jobs in id order, so it never changes between syncs) and the jobs.
  const found = new Map<string, { term: string; jobs: Set<number> }>();
  for (const job of [...jobs].sort((a, b) => a.id - b.id)) {
    const a = parse<Read>(job.analysis, {});
    if (!(a.requirements ?? []).some((r) => r.coverage === 'none')) continue;
    for (const term of termsOf(job, a)) {
      if (!unmetIn(a, term)) continue;
      const k = termKey(term), at = found.get(k) ?? { term, jobs: new Set<number>() };
      at.jobs.add(job.id);
      found.set(k, at);
    }
  }
  return [...found].filter(([, f]) => f.jobs.size >= MIN_JOBS && !facts.some((w) => hasTerm(w, f.term)))
    .map(([k, f]): AgendaFinding => {
      const ids = [...f.jobs].sort((a, b) => a - b);
      return { key: `agenda:term:${k}`, text: `${ids.length} postings you saved ask for ${f.term}, and your record has no story that shows it. Tell one time you worked with it, or say you have not.`,
        data: { kind: 'term', term: f.term, jobs: ids, count: ids.length } };
    })
    .filter((f) => !answered.has(f.key))
    .sort((a, b) => b.data.count - a.data.count || (a.data as { term: string }).term.localeCompare((b.data as { term: string }).term))
    .slice(0, TERMS_OPEN);
}

// 2. One project that the last resumes lean on. A linked line is a bullet that names at least one fact still in the
// record (a summary cites many stories at once, and is not counted). A bullet counts for every project its facts sit in.
// Resumes written before links existed have none, and are not among the resumes counted.
export function leanFinding(input: Pick<AgendaInput, 'resumes' | 'projectOf' | 'titles' | 'answered'>): AgendaFinding[] {
  const resumes = input.resumes.map((r) => ({ id: r.id, links: parseLinks(r.links) })).filter((r) => r.links !== null).slice(0, LAST_RESUMES);
  let total = 0;
  const lines = new Map<number, number>(), usedBy = new Map<number, Set<number>>();
  for (const r of resumes) {
    for (const l of r.links!.lines) {
      if (l.where !== 'bullet') continue;
      const held = l.facts.filter((f) => input.projectOf.has(f));
      if (held.length === 0) continue;
      total++;
      for (const p of new Set(held.map((f) => input.projectOf.get(f)).filter((p): p is number => p !== null && p !== undefined))) {
        lines.set(p, (lines.get(p) ?? 0) + 1);
        usedBy.set(p, (usedBy.get(p) ?? new Set()).add(r.id));
      }
    }
  }
  const lean = [...lines].filter(([p, n]) => n * 2 >= total && (usedBy.get(p)?.size ?? 0) >= MIN_RESUMES && input.titles.has(p) && !input.answered.has(`agenda:lean:${p}`))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (!lean) return [];
  const [p, n] = lean;
  return [{ key: `agenda:lean:${p}`, text: `Your last ${resumes.length} resumes take ${n} of their ${total} linked lines from “${input.titles.get(p)}”. What other work would you put beside it? Tell one piece.`,
    data: { kind: 'lean', project: p, count: n, total, resumes: resumes.length, jobs: [...usedBy.get(p)!].sort((a, b) => a - b) } }];
}

export const agendaFindings = (input: AgendaInput): AgendaFinding[] => [...termFindings(input.jobs, input.answered, input.facts), ...leanFinding(input)];

export function agendaInput(): AgendaInput {
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[], projects = db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  const facts = db.query('SELECT id, role_id, project_id, text, detail, skills FROM facts').all() as { id: number; role_id: number | null; project_id: number | null; text: string; detail: string; skills: string }[];
  return {
    jobs: (db.query("SELECT id, analysis, terms_raw AS termsRaw FROM jobs WHERE outcome = '' AND analysis != ''").all() as AgendaJob[]),
    // Sent or not: what the owner's resumes have been leaning on. Newest job first, by id: no column records when a
    // resume was written (jobs.updated_at also changes when a posting is read again, and resume_versions has a row only
    // once a resume's text changes), so the job added last stands for the resume written last.
    resumes: db.query("SELECT id, links FROM jobs WHERE resume != '' AND links != '' ORDER BY id DESC").all() as AgendaResume[],
    projectOf: new Map(facts.map((f) => [f.id, placeOf(f, roles, projects).project])),
    titles: new Map(tree(roles, projects, []).projects.map((p) => [Number(p.id), p.title])),
    facts: facts.map((f) => `${f.text}\n${f.detail}\n${f.skills}`),
    answered: new Set((db.query("SELECT key FROM raised_questions WHERE kind = 'agenda' AND answered_at > 0").all() as { key: string }[]).map((r) => r.key)),
  };
}

// Brings the agenda's questions in step with the saved postings and the resumes. Called beside syncRecordQuestions
// (lib/gaps.ts) wherever it runs: the server's follow-up after a change, and the worker after a reading and at start.
export const syncAgenda = (now: number) => raise('agenda', agendaFindings(agendaInput()), now);
