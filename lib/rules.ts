// The writing rules as code: one typed list that any writer's output can be passed through before the owner sees it.
// Until now the rules were only instruction text in the prompts (lib/writing.ts), so nothing could refuse a text that
// broke them. Nothing calls this file yet.
//
// Two kinds of rule:
// - Exact rules: code decides. A break means the text must be refused. Each result is pass, break or not-checked, and
//   the verdict can never read "not checked" as "passed": it is ready only when every rule that applies passed.
// - Checklist rules: code only measures, and the owner judges. A checklist item is never a reason to refuse or rewrite,
//   and it never goes to a writer (retryNote).
//
// One principle decides every exact result: a line gets "pass" for a rule only when the code fully understood that
// line. Anything unusual in it (a character outside the plain set, Markdown marks inside a word, a number its facts hold
// for something else, a quantity in words, digits that are no number) makes that rule "not checked" for the line, so
// the text is at best unverified. An honest text that ends unverified or refused is acceptable: the owner sees it. A
// wrong "ready" is not. The writer is the tool's own model, not an attacker, so nothing here decodes or repairs odd
// text: the code only declines to vouch for it.
//
// What needs the record (rules 5 and 6), the person's names and tools, or the posting is passed in by the caller, so this
// file opens no database and asks no model (lib/imports.test.ts).
import type { RoleRow } from './db.ts';
import { actionVerb, density } from './ats.ts';
import { carlOn } from './carl.ts';
import { canonical, checkEntries, employers, normCompany, type FactFinding, type ProjectName } from './entries.ts';
import { noiseSpans } from './metrics.ts';
import { counts, quantities } from './numbers.ts';
import { lf, parseResume, rangesIn, sameDate, sentences, wordCount } from './resume.ts';

export const SURFACES = ['resume', 'profile', 'message', 'answer'] as const;
export type Surface = (typeof SURFACES)[number];

export const EXACT_RULES = ['banned-word', 'line-length', 'document-length', 'technologies-per-line', 'role-heading-as-given', 'number-held-by-record', 'single-column-file', 'parser-reads-record'] as const;
export type ExactRule = (typeof EXACT_RULES)[number];
export const FILE_RULES = ['single-column-file', 'parser-reads-record'] as const;
export type FileRule = (typeof FILE_RULES)[number];

export const CHECKLIST_RULES = ['bullets-alike', 'number-has-context', 'names-something-askable', 'scope-is-own-part', 'echoes-posting', 'strongest-first'] as const;
export type ChecklistRule = (typeof CHECKLIST_RULES)[number];

export type State = 'pass' | 'break' | 'not-checked';
// refused: a rule broke. ready: every rule that applies passed. unverified: nothing broke, but a rule that applies was
// not checked, so the text is neither refused nor ready.
export type Verdict = 'refused' | 'ready' | 'unverified';

// ---------- Banned words ----------

// The words WRITING names today (lib/writing.ts builds its sentence from this list, in this order).
export const PROMPT_BANNED_WORDS = ['leverage', 'utilize', 'facilitate', 'foster', 'enhance', 'showcase', 'robust', 'seamless', 'spearheaded', 'cutting-edge', 'passionate', 'delve', 'crucial', 'pivotal', 'landscape'] as const;
// Every banned word. The last five are refused in code but not yet named in WRITING: naming them changes every prompt,
// and lib/prompts.same.test.ts holds the prompts byte for byte to older commits. Moving them into the prompt needs that
// test's baseline moved on purpose. Until then a writer refused for one of them is told the word (retryNote).
// The list is the owner's own rule for output, so a banned word is refused wherever it stands, also where the owner
// used it about their own work: an exemption for the owner's words let filler through.
export const BANNED_WORDS = [...PROMPT_BANNED_WORDS, 'orchestrated', 'honed', 'streamlined', 'dynamic', 'results-driven'] as const;
export type BannedWord = (typeof BANNED_WORDS)[number];

// The forms of each word that are refused: its ordinary inflections, spelled out so the list is the whole rule.
// Left out on purpose: "landscaped" and "landscaping" (real work on a property, not the buzzword), and "dynamics"
// (a noun, and part of product names such as "Dynamics 365").
export const BANNED_FORMS = {
  leverage: ['leverage', 'leverages', 'leveraged', 'leveraging'],
  utilize: ['utilize', 'utilizes', 'utilized', 'utilizing', 'utilise', 'utilises', 'utilised', 'utilising'],
  facilitate: ['facilitate', 'facilitates', 'facilitated', 'facilitating'],
  foster: ['foster', 'fosters', 'fostered', 'fostering'],
  enhance: ['enhance', 'enhances', 'enhanced', 'enhancing'],
  showcase: ['showcase', 'showcases', 'showcased', 'showcasing'],
  robust: ['robust', 'robustly'],
  seamless: ['seamless', 'seamlessly'],
  spearheaded: ['spearhead', 'spearheads', 'spearheaded', 'spearheading'],
  'cutting-edge': ['cutting-edge', 'cutting edge'],
  passionate: ['passionate', 'passionately'],
  delve: ['delve', 'delves', 'delved', 'delving'],
  crucial: ['crucial', 'crucially'],
  pivotal: ['pivotal', 'pivotally'],
  landscape: ['landscape', 'landscapes'],
  orchestrated: ['orchestrate', 'orchestrates', 'orchestrated', 'orchestrating'],
  honed: ['hone', 'hones', 'honed', 'honing'],
  streamlined: ['streamline', 'streamlines', 'streamlined', 'streamlining'],
  dynamic: ['dynamic', 'dynamically'],
  'results-driven': ['results-driven', 'results driven', 'result-driven'],
} as const satisfies Record<BannedWord, readonly string[]>;

// Ordinary technical terms that hold a banned word. A banned word is exempt only when the whole term stands around it:
// "dynamic pricing" is a method, "a dynamic leader" is filler. Only terms that are hardly ever filler are listed ("a
// dynamic range of skills" is, so "dynamic range" is not). Names (a product, a school, an employer) are not listed
// here: the caller passes them.
export const TERMS = ['dynamic pricing', 'dynamic programming', 'dynamic typing', 'dynamically typed', 'dynamic import', 'dynamic imports', 'dynamic routing',
  'robust regression', 'leverage ratio', 'leverage ratios', 'landscape layout', 'landscape layouts', 'landscape orientation', 'landscape design', 'landscape architect',
  'landscape architects', 'landscape architecture'] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words: no letter or digit right before or after, so "honest" holds no "hone" and "enhancement" no "enhance". A
// space or a dash may stand between the parts of a form or a term.
const wholeRe = (forms: readonly string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...forms].sort((a, b) => b.length - a.length).map((f) => escape(f).split(/[\s-]+/).join('[\\s\\p{Pd}]+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const BANNED_RE = BANNED_WORDS.map((word) => ({ word, re: wholeRe(BANNED_FORMS[word]) }));
const TERMS_RE = wholeRe(TERMS);
// Names as written, with their case. `edge`: what may not stand right before or after one.
const namesRe = (names: string[], edge: string) => (names.length > 0 ? new RegExp(`(?<!${edge})(?:${names.sort((a, b) => b.length - a.length).map(escape).join('|')})(?!${edge})`, 'gu') : null);

type Span = [number, number];
const spansOf = (re: RegExp | null, text: string): Span[] => (re ? [...text.matchAll(re)].map((m): Span => [m.index!, m.index! + m[0].length]) : []);
const within = (s: Span, spans: readonly Span[]) => spans.some(([a, b]) => a <= s[0] && s[1] <= b);
// A word of the same sentence right before a place: a letter or a digit, maybe a comma, then a space.
const AFTER_A_WORD = /[\p{L}\p{N}],?\s+$/u;

// ---------- Limits ----------

export type Limits = { lineWords: number; technologiesPerLine: number; documentWords: number; summaryWords: number; summarySentences: number };
// Starting values to tune, not findings.
export const LIMITS = {
  // Words in one bullet or line: what the writer is told a CARL bullet may hold on two pages (RESUME-RULES.md, rule 13;
  // lib/jobs.ts, limits), and on one page `onePageLineWords`. With no page count, the two-page limit, so no line is held
  // to less than the writer was allowed. lib/ats.ts takes points off past 35. With EGG_CARL=off, 28 as before.
  get lineWords(): number { return carlOn() ? 34 : 28; },
  onePageLineWords: 30,
  // Technologies named in one bullet or line, past which it reads as a stack list.
  technologiesPerLine: 4,
  // Words in a whole resume: the top of the ranges lib/ats.ts (density) uses for one page and for two.
  resumeWords: { 1: density(0, 1).high, 2: density(0, 2).high },
  // Words in a message draft: lib/outreach.ts tells the writer "at most 75 words".
  messageWords: 75,
  // A resume's Summary: SUMMARY_WORDS and SUMMARY_SENTENCES of lib/checks.ts, mirrored because that module opens the
  // database when it is imported.
  summaryWords: 60,
  summarySentences: 3,
} as const;

// ---------- Which rules apply where ----------

// The surfaces each exact rule applies to. A rule that does not apply to a surface is left out of its results: it is
// neither a pass nor "not checked".
export const APPLIES = {
  // WRITING goes to every writer, so its words are banned everywhere.
  'banned-word': ['resume', 'profile', 'message', 'answer'],
  // Every written line of a resume, and its Summary as a whole. The other surfaces are prose, where a line is a paragraph.
  'line-length': ['resume'],
  // A resume (by its pages) and a message (75 words). The project sets no length for a profile or an answer.
  'document-length': ['resume', 'message'],
  // The same lines as line-length.
  'technologies-per-line': ['resume'],
  // Only a resume has role headings.
  'role-heading-as-given': ['resume'],
  // Rule 9: no number is invented, wherever it is printed. On a message and an answer it is always "not checked" for
  // now: they hold numbers that claim nothing ("a 15-minute call", "two reasons"), and no rule yet tells those from a
  // claim. So neither can be ready.
  'number-held-by-record': ['resume', 'profile', 'message', 'answer'],
  // About the printed file, and only a resume is printed.
  'single-column-file': ['resume'],
  'parser-reads-record': ['resume'],
} as const satisfies Record<ExactRule, readonly Surface[]>;
export const applies = (rule: ExactRule, surface: Surface) => (APPLIES[rule] as readonly Surface[]).includes(surface);

// ---------- What the caller passes in ----------

// The result of a check on the printed file, from whoever ran it. No checker exists in this file.
export type FileResult = { ok: true } | { ok: false; problems: readonly string[] };
export type Context = {
  // The person's tools, languages and platforms by name, for technologies-per-line and names-something-askable.
  technologies?: readonly string[];
  // Names from the record (employers, people, schools, products); the roles' employers and titles, the tools and the
  // person's name count too. A name of two or more words excuses a banned word only inside its exact span, with its own
  // case ("Pivotal Tracker"). A name of one word excuses it only capitalised, as a whole token, right after a word of
  // its sentence: "tracked in Pivotal", never "Pivotal in moving…". A name that begins with a letter and holds a digit
  // ("Dynamics 365") is the record's text, so its digits are no number.
  names?: readonly string[];
  // The person's name and the parts of their contact line, as the record has them. Only these are not read; without
  // them the name and contact lines are read like any other line.
  person?: { name?: string; contact?: readonly string[] };
  // Rule 5: the record's roles (and its projects of roles, for the words of a finding). Their headings, dates lines,
  // "Previously" lines, notes and Earlier experience items are text the record supplies.
  roles?: readonly RoleRow[];
  projects?: readonly ProjectName[];
  // Rule 5 under Education (and Certifications): the lines the record holds there, as they would be printed. A line
  // there that equals one is not read; any other line there leaves rule 5 not checked.
  education?: readonly string[];
  // Rule 6. `stated`: the text of every fact the writer may draw on, joined (the same fields lib/checks.ts joins).
  // `cites`: for each line, the text of only the facts that line's link keys name (lib/links.ts), keyed as lib/links.ts
  // keys a line (places): on a resume a bullet's text as lib/resume.ts reads it and the Summary's text as one; on any
  // other surface the line without its bullet mark. Only a line checked against its own facts can pass.
  record?: { stated: string; cites?: ReadonlyMap<string, string> };
  // A resume's length in pages, for document-length. Not given: that rule is not checked.
  pages?: 1 | 2;
  limits?: Partial<Limits>;
  file?: Partial<Record<FileRule, FileResult>>;
  // echoes-posting: the posting's terms, and the terms the record supports.
  posting?: { terms: readonly string[]; supported: readonly string[] };
  // strongest-first: the bullets' texts, strongest first, as the caller ranks them.
  strongest?: readonly string[];
};

// The limits for a surface: the caller's, else the defaults. documentWords is null where no length is known. A limit
// that is not a whole number above 0 is a mistake of the caller, and is thrown: NaN would let anything through.
export function limitsFor(surface: Surface, context: Pick<Context, 'pages' | 'limits'> = {}): Omit<Limits, 'documentWords'> & { documentWords: number | null } {
  for (const [name, value] of Object.entries(context.limits ?? {})) {
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) throw new Error(`The limit ${name} must be a whole number above 0, not ${String(value)}.`);
  }
  if (context.pages !== undefined && context.pages !== 1 && context.pages !== 2) throw new Error(`A resume has 1 or 2 pages, not ${String(context.pages)}.`);
  const fallback = surface === 'resume' ? (context.pages ? LIMITS.resumeWords[context.pages] : null) : surface === 'message' ? LIMITS.messageWords : null;
  const l = context.limits ?? {};
  return { lineWords: l.lineWords ?? (carlOn() && context.pages === 1 ? LIMITS.onePageLineWords : LIMITS.lineWords), technologiesPerLine: l.technologiesPerLine ?? LIMITS.technologiesPerLine, documentWords: l.documentWords ?? fallback,
    summaryWords: l.summaryWords ?? LIMITS.summaryWords, summarySentences: l.summarySentences ?? LIMITS.summarySentences };
}

// ---------- Results ----------

// A line is counted from 1. The quote is the line as written, trimmed.
export type At = { line: number; quote: string };
export type HitOf = {
  'banned-word': At & { word: BannedWord; found: string };
  // A line past its word limit, or the Summary past its words or its sentences (then `sentences` is set).
  'line-length': At & { words: number; limit: number; sentences?: { count: number; limit: number } };
  'document-length': { words: number; limit: number };
  'technologies-per-line': At & { technologies: string[]; limit: number };
  'role-heading-as-given': { kind: FactFinding['kind']; entry: string; was: string; is: string; text: string };
  'number-held-by-record': At & { number: string };
  'single-column-file': { problem: string };
  'parser-reads-record': { problem: string };
};
// One result per rule. Only a break has hits, and it always has at least one. "not-checked" says why.
export type RuleResult<R extends ExactRule = ExactRule> = R extends ExactRule
  ? { rule: R; state: 'pass' } | { rule: R; state: 'break'; hits: readonly [HitOf[R], ...HitOf[R][]] } | { rule: R; state: 'not-checked'; why: string }
  : never;

export type BulletsAlike = { role: string; bullets: number; words: { fewest: number; most: number; mean: number; spread: number }; opener: { word: string; share: number } };
export type ChecklistItem =
  | { rule: 'bullets-alike'; state: 'measured'; roles: BulletsAlike[] }
  | { rule: 'number-has-context'; state: 'measured'; lines: (At & { numbers: string[] })[] }
  | { rule: 'names-something-askable'; state: 'measured'; lines: At[] }
  | { rule: 'scope-is-own-part'; state: 'owner-judges' }
  | { rule: 'echoes-posting'; state: 'measured'; terms: (At & { term: string })[] }
  | { rule: 'strongest-first'; state: 'measured'; roles: { role: string; ranked: number; firstIsStrongest: boolean; outOfOrder: number }[] }
  | { rule: Exclude<ChecklistRule, 'scope-is-own-part'>; state: 'not-measured'; why: string };

export type Checked = { surface: Surface; verdict: Verdict; exact: RuleResult[]; checklist: ChecklistItem[] };

// ---------- The text, read once ----------

// What a line of the text is:
// - top: above a resume's first section (the name, a contact line, a tagline);
// - header: a "##" section line of a resume, or a "#" heading line of any other surface;
// - supplied: equals text the record supplies (a role's heading, dates line, "Previously" line or note; an Earlier
//   experience line of the record's items; an Education line of the record). The rules on writing do not read it.
// - heading, dates: a role's heading, or its dates or "Previously" line, that differs from the record. Rule 5 checks
//   it, and it is read like written text;
// - earlier: an Earlier experience line that differs from the record;
// - skills, education, summary: a line of those sections of a resume;
// - technologies: an entry's Technologies line (RESUME-RULES.md, rule 14), a list that code writes;
// - bullet: a bullet of a role;
// - body: any other line.
type Kind = 'top' | 'header' | 'supplied' | 'heading' | 'dates' | 'earlier' | 'skills' | 'education' | 'technologies' | 'summary' | 'bullet' | 'body';
// `read`: what the banned-word and number rules read: the line without its marks, a link as its text, '' for text the
// record supplies (of a top line, only the parts that are not the person's). `odd`: why neither rule can vouch for it.
// `cited`: the facts it cites. `dates`: its date ranges that equal a dated row of its own employer in the record.
type Line = { line: number; text: string; kind: Kind; bullet: boolean; read: string; odd: string; linkDigits: boolean; cited?: string; dates: string[] };
type Role = { heading: string; bullets: { line: number; text: string }[] };
type Read = { all: string; lines: Line[]; roles: Role[] };

// A bullet's mark, or a numbered list's ("1. ", "2) "): neither is a word or a count.
const marker = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
const unmark = (text: string) => text.replace(marker, '');
const strip = (text: string) => unmark(text.replace(/^#{1,6}\s+/, ''));
const same = (s: string) => strip(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// The sections, as lib/resume.ts (sectionOf, not exported) names them, with Certifications read as Education.
function sectionOf(name: string): 'summary' | 'skills' | 'education' | 'earlier' | 'other' {
  const n = name.toLowerCase().replace(/[^a-z& ]/g, '').trim();
  if (/^(professional |career )?summary$|^profile$|^about( me)?$/.test(n)) return 'summary';
  if (/^(earlier|previous|additional|prior|other) (experience|roles|career)$/.test(n)) return 'earlier';
  if (/^(technical |core )?skills$|^technologies$/.test(n)) return 'skills';
  if (/^(education|certifications?)( (and|&) (certifications?|training))?$/.test(n)) return 'education';
  return 'other';
}

// The characters the code reads: ASCII letters, digits, space and punctuation; the quotes, dashes, middle dot, bullet
// and ellipsis that this project's writers and PDF use; and Latin letters with accents, which names hold ("José",
// "Łódź"). This allow-list is the whole rule: a line with any other character is not vouched for, and nothing maps such
// a character to a plain one.
const PLAIN = /^[\x20-\x7E‘’“”–—·•…À-ÖØ-öø-ſ]*$/;
// Markdown emphasis or code marks, once a list's mark is gone. Inside a word ("ro**bust**") or beside one ("cutting
// **edge**", "**640** users") they part what the checks read as one: the word as printed is not the word as read.
const MARKS = /[*_~`]/;
// A Markdown link: its text is read, its address is not.
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

function lineOf(i: number, text: string, kind: Kind, shown: string, cited?: string, dates: string[] = []): Line {
  let linkDigits = false;
  const read = shown.replace(LINK, (_m, label: string, url: string) => { if (/\d/.test(url)) linkDigits = true; return label; });
  const odd = !PLAIN.test(read) ? 'it holds a character the check does not read' : MARKS.test(read) ? 'it holds Markdown marks' : '';
  return { line: i + 1, text, kind, bullet: marker.test(text), read, odd, linkDigits, cited, dates };
}

function readText(surface: Surface, text: string, context: Context): Read {
  const raw = lf(text).split('\n'), all = raw.join('\n'), cites = context.record?.cites;
  const filled = raw.map((t, i) => ({ i, t: t.trim() })).filter((x) => x.t !== '');
  if (surface !== 'resume') return { all, roles: [], lines: filled.map(({ i, t }) => lineOf(i, t, /^#{1,6}\s/.test(t) ? 'header' : 'body', strip(t), cites?.get(unmark(t).trim()))) };
  const roles = [...(context.roles ?? [])];
  const resume = parseResume(all, roles.map((r) => r.company));
  const canons = employers(roles).map(canonical);
  const supplied = new Set([...canons.flatMap((c) => [c.heading, c.dates, ...c.previously, c.note]), ...(context.education ?? [])].filter(Boolean).map(same));
  const earlier = new Set(canons.map((c) => same(c.earlier)));
  const person = { name: same(context.person?.name ?? ''), contact: new Set((context.person?.contact ?? []).map(same).filter(Boolean)) };
  const entries = [...resume.experience, ...resume.projects, ...resume.elsewhere];
  const headings = new Set(entries.map((e) => e.at.heading)), technologies = new Set(entries.flatMap((e) => e.at.technologies));
  // A dates or Previously line, with the dated rows of its own employer in the record. lib/entries.ts compares its
  // ranges only when that employer has dated rows, so a range counts as the record's only when it equals one of them.
  const datesOf = new Map<number, RoleRow[]>();
  for (const e of entries) {
    const rows = roles.filter((r) => r.start !== '' && normCompany(r.company) === normCompany(e.company || e.title));
    for (const i of [e.at.dates, ...e.at.previously]) datesOf.set(i, rows);
  }
  // The keys lib/links.ts gives a line (places): a bullet's text as lib/resume.ts reads it, and the Summary as one.
  const bullets = new Map(resume.outline.filter((o) => o.kind === 'bullet').map((o) => [o.line, o.text]));
  let section: ReturnType<typeof sectionOf> | 'top' = 'top';
  const lines = filled.map(({ i, t }): Line => {
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h && h[1].length === 2) { section = sectionOf(h[2]); return lineOf(i, t, 'header', strip(t)); }
    if (section === 'top') {
      if (h && h[1].length === 1) return lineOf(i, t, 'top', person.name !== '' && same(h[2]) === person.name ? '' : h[2]);
      // A contact part is not read only when it equals one the record gives for the person.
      return lineOf(i, t, 'top', t.split(/\s+[·|•]\s+/).filter((p) => !person.contact.has(same(p))).join(' · '));
    }
    if (section === 'earlier') {
      const items = unmark(t).split(/\s*;\s*/).map((x) => same(x.replace(/\.$/, ''))).filter(Boolean);
      return items.length > 0 && items.every((x) => earlier.has(x)) ? lineOf(i, t, 'supplied', '') : lineOf(i, t, 'earlier', strip(t));
    }
    if (supplied.has(same(t))) return lineOf(i, t, 'supplied', '');
    if (section === 'skills' || section === 'education') return lineOf(i, t, section, strip(t));
    if (headings.has(i)) return lineOf(i, t, 'heading', strip(t));
    if (technologies.has(i)) return lineOf(i, t, 'technologies', strip(t));
    const rows = datesOf.get(i);
    if (rows) return lineOf(i, t, 'dates', strip(t), undefined, rangesIn(strip(t)).filter((x) => rows.some((r) => sameDate(x.start, r.start) && sameDate(x.end, r.end))).map((x) => x.text));
    if (bullets.has(i)) return lineOf(i, t, 'bullet', strip(t), cites?.get(bullets.get(i)!));
    return section === 'summary' ? lineOf(i, t, 'summary', strip(t), cites?.get(resume.summary)) : lineOf(i, t, 'body', strip(t));
  });
  const roleList = entries.filter((e) => e.bullets.length > 0).map((e) => ({ heading: e.heading, bullets: e.at.lines.filter((i) => bullets.has(i)).map((i) => ({ line: i + 1, text: raw[i].trim() })) }));
  return { all, lines, roles: roleList };
}
// The lines whose length and tools are measured: every written line of a resume but a section line, a line the record
// supplies, a Skills line or a Technologies line (lists, which name many tools by design and are capped elsewhere,
// lib/skills.ts) and the Summary's prose, which is measured as a whole (summaryOf). A bullet in the Summary is measured as a line.
const measured = (r: Read) => r.lines.filter((l) => !['header', 'supplied', 'skills', 'technologies'].includes(l.kind) && !(l.kind === 'summary' && !l.bullet));
// The Summary's prose: its lines that are no bullet.
const summaryOf = (r: Read) => r.lines.filter((l) => l.kind === 'summary' && !l.bullet);
// What the checklist reads: a resume's summary and the lines of its roles; every line but a heading elsewhere.
const prose = (surface: Surface, r: Read) => (surface === 'resume' ? r.lines.filter((l) => ['body', 'bullet', 'summary'].includes(l.kind)) : r.lines.filter((l) => l.kind !== 'header'));

// The names a text holds, each once, in the caller's spelling and in the order of the text. Longer names go first and
// their place is blanked, so "React Native" is one name and not also "React". A name of one or two letters ("Go", "R",
// "C") is matched with its case, and only as a token of its own: not joined by a dash, "&", "/", "+" or "#" to more
// ("Go-to-market", "R&D", "C-suite", "C++"). `anyCase`: for words that are not tool names (a posting's terms).
type Finder = (text: string) => string[];
function finder(names: readonly string[], anyCase = false): Finder {
  const res = [...new Set(names.map((x) => x.trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map((name) => {
    const short = !anyCase && name.replace(/[^\p{L}]/gu, '').length <= 2;
    return { name, re: short ? new RegExp(`(?<![\\p{L}\\p{N}\\p{Pd}&/+#])${escape(name)}(?![\\p{L}\\p{N}\\p{Pd}&/+#])`, 'gu') : new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu') };
  });
  return (text) => {
    let rest = text;
    const out: { name: string; at: number }[] = [];
    for (const { name, re } of res) {
      let at = -1;
      rest = rest.replace(re, (m, offset: number) => { if (at < 0) at = offset; return ' '.repeat(m.length); });
      if (at >= 0) out.push({ name, at });
    }
    return out.sort((a, b) => a.at - b.at).map((x) => x.name);
  };
}

// Everything worked out once per call, so no rule reads the context again for each line.
type Run = { surface: Surface; read: Read; context: Context; limits: ReturnType<typeof limitsFor>; empty: boolean; tech: Finder | null;
  names: RegExp | null; oneWord: RegExp | null; digitNames: RegExp | null; entries: FactFinding[] | null; held: () => Set<number>; cited: (text: string) => Num[] };

function prepare(surface: Surface, text: string, context: Context): Run {
  const limits = limitsFor(surface, context);
  const read = readText(surface, text, context);
  const names = [...new Set([...(context.names ?? []), ...(context.technologies ?? []), ...(context.roles ?? []).flatMap((r) => [r.company, r.title]), context.person?.name ?? ''].map((n) => n.trim()).filter(Boolean))];
  let held: Set<number> | undefined;
  const cited = new Map<string, Num[]>();
  return { surface, read, context, limits, empty: !/[\p{L}\p{N}]/u.test(read.all),
    tech: context.technologies && context.technologies.length > 0 ? finder(context.technologies) : null,
    names: namesRe(names.filter((n) => /\s/.test(n)), '[\\p{L}\\p{N}]'),
    oneWord: namesRe(names.filter((n) => !/\s/.test(n) && /^\p{Lu}/u.test(n)), '[\\p{L}\\p{N}\\p{Pd}&/+#]'),
    digitNames: namesRe(names.filter((n) => /^\p{L}/u.test(n) && /\d/.test(n)), '[\\p{L}\\p{N}]'),
    entries: surface === 'resume' && context.roles ? checkEntries(read.all, [...context.roles], [...(context.projects ?? [])]) : null,
    // Every value the record names in any form, read once. A value outside it is nowhere in the record.
    held: () => (held ??= new Set(quantities(context.record?.stated ?? '').map((q) => q.value))),
    cited: (t) => cited.get(t) ?? cited.set(t, numbersAt(t)).get(t)! };
}

const nonEmpty = <H>(hits: H[]): hits is [H, ...H[]] => hits.length > 0;
// A rule's result from its hits and the reasons it could not vouch for a line: any hit breaks it, any reason leaves it
// not checked, and only nothing at all is a pass.
const judged = <R extends ExactRule>(rule: R, hits: HitOf[R][], why: string[] = []) =>
  (nonEmpty(hits) ? { rule, state: 'break', hits } : why.length > 0 ? { rule, state: 'not-checked', why: [...new Set(why)].join(' ') } : { rule, state: 'pass' }) as RuleResult<R>;
const notChecked = <R extends ExactRule>(rule: R, why: string) => judged(rule, [], [why]);

// ---------- Banned words ----------

// Every banned match in a line as written. A match is excused only when its whole span lies inside a listed term, a
// name of two or more words as written, or a name of one word that stands right after a word of its sentence. Nothing
// excuses a whole line, a whole text or a whole family of a word.
function bannedLine(text: string, run: Run): { word: BannedWord; found: string }[] {
  const found = BANNED_RE.flatMap(({ word, re }) => [...text.matchAll(re)].map((m) => ({ word, found: m[0], span: [m.index!, m.index! + m[0].length] as Span })));
  if (found.length === 0) return [];
  const excused = [...spansOf(TERMS_RE, text), ...spansOf(run.names, text), ...spansOf(run.oneWord, text).filter(([a]) => AFTER_A_WORD.test(text.slice(0, a)))];
  return found.filter((h) => !within(h.span, excused)).map(({ word, found: f }) => ({ word, found: f }));
}
function banned(run: Run): RuleResult<'banned-word'> {
  const lines = run.read.lines.filter((l) => l.read !== '');
  return judged('banned-word', lines.flatMap((l) => bannedLine(l.read, run).map((h) => ({ ...h, line: l.line, quote: l.text }))),
    lines.filter((l) => l.odd).map((l) => `Line ${l.line}: ${l.odd}.`));
}

// ---------- Numbers ----------

const ON_CLAIMS = (surface: Surface) => `No rule exists yet for the claims in ${surface === 'message' ? 'a message' : 'an answer'}: a number that claims nothing ("a 15-minute call") cannot yet be told from one that claims a result.`;

// Words that state a quantity without digits, read wherever lib/numbers.ts read no number: the number words it drops as
// part of a name ("ten-fold", "two-thirds"), "one" (it reads that as "a"), and words such as "tripled" or "dozens". No
// such list is complete ("a third" is not on it).
const QUANTITY_WORDS = /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|(?:twen|thir|for|fif|six|seven|eigh|nine)ty|hundred|thousand|million|billion|dozen)(?:s|fold)?|twice|thrice|half|halv\w*|doubl\w*|tripl\w*|quadrupl\w*)\b/gi;
// Words that say nothing about what a number counts: the list lib/numbers.ts reads.
const STOP = new Set('of to in on at for by from and or the a an per more fewer less than over under across with into out up down about around nearly almost plus each every it its their our my his her that this which who as was were is are be been'.split(' '));

// A number with its place in its text. `unit`: percent, times, or a currency's symbol. What it counts: `noun`, the word
// right after it (as lib/numbers.ts reads it), else `before`, the content words before it in its clause. `word`: it
// has no digit.
type Num = { text: string; at: number; end: number; value: number; unit: string; noun: string; before: string[]; word: boolean };
// A clause ends at punctuation followed by a space, so "4,000" and "Node.js" stay whole.
const clauseBefore = (text: string, at: number) => (text.slice(0, at).split(/[.,;:!?](?=\s)/).pop()!.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => !STOP.has(w));
// The same thing counted: the same word right after both numbers; with none after this one, every content word before
// it in its clause stands before the other too ("Cut costs by 12%" and "Cut hosting costs by 12%", never "Costs grew
// by 40%" and "Revenue grew 40%"). With no word at all, nothing is known to be counted.
const sameThing = (n: Num, c: Num) => (n.noun !== '' ? n.noun === c.noun : n.before.length > 0 && n.before.every((w) => c.before.includes(w)));
const blank = (t: string, a: number, b: number) => t.slice(0, a) + ' '.repeat(b - a) + t.slice(b);
// Every number of a text: each one lib/numbers.ts reads (in digits or words, never a name such as "p95"), then each
// quantity word in what is left. A number is found after the one before it, which never fails: they are read from this
// text, in order.
function numbersAt(text: string): Num[] {
  const out: Num[] = [];
  let from = 0, rest = text;
  for (const q of quantities(text)) {
    const at = text.indexOf(q.text, from);
    from = at + q.text.length;
    rest = blank(rest, at, from);
    out.push({ text: q.text, at, end: from, value: q.value, unit: q.unit === 'money' ? q.text[0] : q.unit, noun: q.noun, before: clauseBefore(text, at), word: !/\d/.test(q.text) });
  }
  for (const m of rest.matchAll(QUANTITY_WORDS)) {
    const at = m.index!, end = at + m[0].length, next = /^[\s-]*(\p{L}+)/u.exec(text.slice(end))?.[1]?.toLowerCase() ?? '';
    out.push({ text: m[0], at, end, value: NaN, unit: '', noun: STOP.has(next) ? '' : next, before: clauseBefore(text, at), word: true });
  }
  return out;
}

// Rule 6, line by line. With the facts a line cites, a number (a year or a date too) breaks when they hold no number of
// its value, and passes only when they hold its value, with its percent or currency, counting the same thing. Against
// the whole record a number can only break, and a year or a date is not judged. A quantity in words never breaks, and
// passes only on the same word about the same thing. A count of years is never judged. Digits no number accounts for
// (a code such as "p95") leave the line not checked, unless the cited facts hold the same code.
function numbers(run: Run): RuleResult<'number-held-by-record'> {
  const rule = 'number-held-by-record';
  if (!run.context.record) return notChecked(rule, 'The record’s facts were not given.');
  const hits: HitOf[typeof rule][] = [], why: string[] = [];
  for (const l of run.read.lines.filter((x) => x.read !== '')) {
    const say = (s: string) => why.push(`Line ${l.line}: ${s}.`), hit = (number: string) => { if (!hits.some((h) => h.line === l.line && h.number === number)) hits.push({ line: l.line, quote: l.text, number }); };
    if (l.odd) say(l.odd);
    if (l.linkDigits) say('it links to an address that holds digits');
    let text = run.digitNames ? l.read.replace(run.digitNames, (m) => ' '.repeat(m.length)) : l.read;
    // A role's dates that equal the record's are rule 5's (role-heading-as-given).
    for (const d of l.dates) { const at = text.indexOf(d); if (at >= 0) text = blank(text, at, at + d.length); }
    const nums = numbersAt(text), cited = l.cited, theirs = cited === undefined ? null : run.cited(cited);
    const dates = theirs ? [] : noiseSpans(text, ['dates']);
    for (const n of nums) {
      const quote = `“${n.text}”`;
      if (/^(?:years?|yrs?)$/.test(n.noun)) say(`${quote} is a count of years, which nothing here can judge`);
      else if (theirs) {
        const alike = theirs.filter((c) => (n.word ? c.text.toLowerCase() === n.text.toLowerCase() : c.value === n.value));
        if (alike.length === 0 && !n.word) hit(n.text);
        else if (!alike.some((c) => c.unit === n.unit && sameThing(n, c))) say(`the facts it cites do not hold ${quote} counting the same thing`);
      } else if (!n.word && !run.held().has(n.value) && !dates.some(([a, b]) => a <= n.at && n.end <= b)) hit(n.text);
      else say(`${quote} can be confirmed only by the facts the line cites, which were not given`);
    }
    for (const m of nums.reduce((t, n) => blank(t, n.at, n.end), text).matchAll(/\S*\d\S*/g)) {
      const code = m[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!(cited !== undefined && /[\p{L}/]/u.test(code) && new RegExp(`(?<![\\p{L}\\p{N}])${escape(code)}(?![\\p{L}\\p{N}])`, 'iu').test(cited))) say(`“${code}” holds digits that are read as no number`);
    }
  }
  return judged(rule, hits, why);
}

// ---------- The other exact rules ----------

function lengths(run: Run): RuleResult<'line-length'> {
  const { lineWords, summaryWords, summarySentences } = run.limits;
  const hits: HitOf['line-length'][] = measured(run.read).map((l) => ({ line: l.line, quote: l.text, words: wordCount(unmark(l.text)), limit: lineWords })).filter((h) => h.words > h.limit);
  const summary = summaryOf(run.read);
  if (summary.length > 0) {
    const text = summary.map((l) => l.text).join(' '), words = wordCount(text), count = sentences(text).length;
    if (words > summaryWords || count > summarySentences) hits.unshift({ line: summary[0].line, quote: summary[0].text, words, limit: summaryWords, sentences: { count, limit: summarySentences } });
  }
  return judged('line-length', hits.sort((a, b) => a.line - b.line));
}

// Rule 5: every finding of lib/entries.ts (checkEntries) but its "loose" dated lines, which are judged here by where they
// stand. A line with a date range that is no part of a role entry, anywhere but Education, states a role the record
// does not hold. A line under Education that the record does not supply cannot be judged: a degree is no role.
const DATED: readonly Kind[] = ['top', 'summary', 'skills', 'body'];
function roleHeadings(run: Run): RuleResult<'role-heading-as-given'> {
  const rule = 'role-heading-as-given', lines = run.read.lines;
  if (!run.entries) return notChecked(rule, 'The record’s roles were not given.');
  return judged(rule, [...run.entries.filter((f) => !f.loose).map(({ kind, entry, was, is, text }) => ({ kind, entry, was, is, text })),
    ...lines.filter((l) => DATED.includes(l.kind) && rangesIn(l.read.replace(/[*_`]/g, '')).length > 0).map((l) => ({ kind: 'unknown' as const, entry: l.read, was: l.read, is: '',
      text: `Line ${l.line} has dates but is no part of a role entry: “${l.read}”. Your record holds no role written that way. A job is written only as an entry under Experience, with the heading and dates the record gives.` }))],
  lines.filter((l) => l.kind === 'education').map((l) => `Line ${l.line} under Education is not a line of the record’s education or certifications.`));
}

function runRule(rule: ExactRule, run: Run): RuleResult {
  const { surface, read, context, limits } = run;
  if (run.empty) return notChecked(rule, 'The text has no words.');
  switch (rule) {
    case 'banned-word':
      return banned(run);
    case 'line-length':
      return lengths(run);
    case 'document-length': {
      if (limits.documentWords === null) return notChecked(rule, surface === 'resume' ? 'The resume’s number of pages was not given.' : `No word limit is set for a ${surface}.`);
      // Counted as lib/ats.ts (draftScore) counts a resume: Markdown marks are not words.
      const words = wordCount(read.all.replace(/[#*_`>|]/g, ' '));
      return judged(rule, words > limits.documentWords ? [{ words, limit: limits.documentWords }] : []);
    }
    case 'technologies-per-line': {
      const tech = run.tech;
      if (!tech) return notChecked(rule, 'No list of technologies was given.');
      return judged(rule, measured(read).map((l) => ({ line: l.line, quote: l.text, technologies: tech(unmark(l.text)), limit: limits.technologiesPerLine })).filter((h) => h.technologies.length > h.limit));
    }
    case 'role-heading-as-given':
      return roleHeadings(run);
    case 'number-held-by-record':
      return surface === 'message' || surface === 'answer' ? notChecked(rule, ON_CLAIMS(surface)) : numbers(run);
    case 'single-column-file':
    case 'parser-reads-record': {
      const result = context.file?.[rule];
      if (!result) return notChecked(rule, 'The printed file was not checked.');
      return judged(rule, result.ok ? [] : (result.problems.length > 0 ? result.problems : ['The check of the file failed.']).map((problem) => ({ problem })));
    }
    default: {
      const unknown: never = rule;
      throw new Error(`No such rule: ${String(unknown)}`);
    }
  }
}

// The verdict of a set of results. Any break refuses. Ready needs every result to be a pass, so a rule that was not
// checked can never make a text ready. No results at all is not ready either.
export function verdictOf(results: readonly RuleResult[]): Verdict {
  if (results.some((r) => r.state === 'break')) return 'refused';
  return results.length > 0 && results.every((r) => r.state === 'pass') ? 'ready' : 'unverified';
}

// ---------- Checklist ----------

// A bullet's opener is its action verb: with CARL the first word after an opening context clause, if it has one
// (lib/ats.ts); with EGG_CARL=off its first word, as before.
const firstWord = (text: string) => (carlOn() ? actionVerb(unmark(text)) : (unmark(text).split(/\s+/)[0] ?? '').toLowerCase()).replace(/[^\p{L}\p{N}-]+/gu, '');
const round = (n: number) => Math.round(n * 100) / 100;

function alike(role: Role): BulletsAlike {
  const words = role.bullets.map((b) => wordCount(unmark(b.text))), n = words.length;
  const mean = words.reduce((a, b) => a + b, 0) / n;
  const tally = new Map<string, number>();
  for (const b of role.bullets) tally.set(firstWord(b.text), (tally.get(firstWord(b.text)) ?? 0) + 1);
  const [word, count] = [...tally].sort((a, b) => b[1] - a[1])[0];
  return { role: role.heading, bullets: n, words: { fewest: Math.min(...words), most: Math.max(...words), mean: round(mean), spread: round(Math.sqrt(words.reduce((s, w) => s + (w - mean) ** 2, 0) / n)) },
    opener: { word, share: round(count / n) } };
}

function runChecklist(rule: ChecklistRule, run: Run): ChecklistItem {
  const { surface, read, context } = run;
  const lines = prose(surface, read);
  switch (rule) {
    case 'bullets-alike':
      if (surface !== 'resume' || read.roles.length === 0) return { rule, state: 'not-measured', why: 'There are no roles with bullets to compare.' };
      return { rule, state: 'measured', roles: read.roles.map(alike) };
    case 'number-has-context':
      return { rule, state: 'measured', lines: lines.map((l) => ({ line: l.line, quote: l.text, numbers: [...new Set(counts(unmark(l.text)).map((x) => x.text))] })).filter((l) => l.numbers.length > 0) };
    case 'names-something-askable': {
      // A list for the owner to read, never a reason to add a number or a tool to a line.
      const tech = run.tech;
      if (!tech) return { rule, state: 'not-measured', why: 'No list of technologies was given.' };
      return { rule, state: 'measured', lines: lines.filter((l) => tech(unmark(l.text)).length === 0 && counts(unmark(l.text)).length === 0).map((l) => ({ line: l.line, quote: l.text })) };
    }
    case 'scope-is-own-part':
      return { rule, state: 'owner-judges' };
    case 'echoes-posting': {
      if (!context.posting) return { rule, state: 'not-measured', why: 'The posting’s terms and the terms the record supports were not given.' };
      const supported = new Set(context.posting.supported.map((t) => t.trim().toLowerCase()));
      const find = finder(context.posting.terms.filter((t) => t.trim() !== '' && !supported.has(t.trim().toLowerCase())), true);
      return { rule, state: 'measured', terms: lines.flatMap((l) => find(unmark(l.text)).map((term) => ({ line: l.line, quote: l.text, term }))) };
    }
    case 'strongest-first': {
      if (!context.strongest || context.strongest.length === 0) return { rule, state: 'not-measured', why: 'No ranking of the bullets was given.' };
      const rank = new Map(context.strongest.map((t, i) => [unmark(t).trim(), i]));
      const groups = surface === 'resume' ? read.roles : [{ heading: '', bullets: lines }];
      return { rule, state: 'measured', roles: groups.map((g) => {
        const ranks = g.bullets.map((b) => rank.get(unmark(b.text).trim())).filter((r): r is number => r !== undefined);
        let outOfOrder = 0;
        for (let i = 0; i < ranks.length; i++) for (let j = i + 1; j < ranks.length; j++) if (ranks[i] > ranks[j]) outOfOrder++;
        return { role: g.heading, ranked: ranks.length, firstIsStrongest: ranks.length > 0 && ranks[0] === Math.min(...ranks), outOfOrder };
      }) };
    }
    default: {
      const unknown: never = rule;
      throw new Error(`No such checklist rule: ${String(unknown)}`);
    }
  }
}

// ---------- The one call ----------

// Every exact rule that applies to the surface, the verdict, and the checklist. The text is what would be printed or
// sent: a writer's link keys ("{fact:2}", lib/links.ts) must be taken out first, or their numbers are read as counts.
// A text with no word is never ready: every rule is "not checked".
export function check(surface: Surface, text: string, context: Context = {}): Checked {
  const run = prepare(surface, text, context);
  const exact = EXACT_RULES.filter((r) => applies(r, surface)).map((r) => runRule(r, run));
  return { surface, verdict: verdictOf(exact), exact, checklist: CHECKLIST_RULES.map((r) => runChecklist(r, run)) };
}

// ---------- What a writer is told ----------

const quoted = (s: string) => `“${s}”`;
function noteFor(r: RuleResult): string[] {
  if (r.state !== 'break') return [];
  switch (r.rule) {
    case 'banned-word': return r.hits.map((h) => `Line ${h.line} uses ${quoted(h.found)}, a word that is never used. Say what was done in plain words. The line: ${quoted(h.quote)}`);
    case 'line-length': return r.hits.map((h) => (h.sentences
      ? `The Summary has ${h.words} words in ${h.sentences.count} ${h.sentences.count === 1 ? 'sentence' : 'sentences'}. The most is ${h.limit} words in ${h.sentences.limit} sentences.`
      : `Line ${h.line} has ${h.words} words. The most is ${h.limit}. The line: ${quoted(h.quote)}`));
    case 'document-length': return r.hits.map((h) => `The text has ${h.words} words. The most is ${h.limit}.`);
    case 'technologies-per-line': return r.hits.map((h) => `Line ${h.line} names ${h.technologies.length} technologies (${h.technologies.join(', ')}). The most is ${h.limit}. The line: ${quoted(h.quote)}`);
    case 'role-heading-as-given': return r.hits.map((h) => h.text);
    case 'number-held-by-record': return r.hits.map((h) => `Line ${h.line} uses ${quoted(h.number)}, which no fact it may draw on holds. Take the number out, or say only what the cited fact says. The line: ${quoted(h.quote)}`);
    case 'single-column-file':
    case 'parser-reads-record': return r.hits.map((h) => `The printed file: ${h.problem}`);
    default: {
      const unknown: never = r;
      throw new Error(`No such rule: ${String(unknown)}`);
    }
  }
}
// The note a refused writer gets for its next try: each broken rule, with the exact words or line that broke it, so a
// writer refused for a word the prompt does not name yet ("dynamic") is told the word. It holds nothing from the
// checklist: those are measures for the owner to judge, and sent to a writer they would push it to add a number or a
// tool to a line, or to reorder by a measure that is no rule. "Not checked" is no fault of the writer, and is left out.
export function retryNote(checked: Pick<Checked, 'exact'>): string {
  return checked.exact.flatMap(noteFor).map((l) => `- ${l}`).join('\n');
}
