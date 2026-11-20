// Deriving a told story (DESIGN.md section 11): the owner talks freely in a telling sitting (lib/sittings.ts), and a
// model writes the project's four CARL parts and a few facts from what they said. Never on its own: a sitting that ends
// with something said queues the project, and so does "Write it again from what you said" and a deleted answer. The
// worker makes one model request, and code checks every part and fact before anything is written: a quote must be in
// the answer it names, character for character, and a number must stand in what the owner said about this project.
//
// What is written never overwrites the owner: a part is written only while it is empty or still holds what deriving
// last wrote (projects.derived), and a fact the owner edited is confirmed and stays. Derived facts are proposed and
// told (facts.told): deriving again replaces them, and nothing else rewords or deletes them. Each carries the passages
// it quotes as told origins (lib/origins.ts). The owner's title is never replaced, so the model is not asked for one.
import { db, KINDS, nextId, norm } from './db.ts';
import { ask } from './llm.ts';
import { setStage } from './activity.ts';
import { addOrigin, checkSpan } from './origins.ts';
import { WRITING } from './writing.ts';
import { PART_NAMES } from './capture.ts';
import { hasSaid, queueDerive, toldAbout, type Told } from './sittings.ts';

export const CARL = ['context', 'action', 'result', 'learning'] as const;
export type CarlPart = (typeof CARL)[number];
// At most this many facts for one story, quotes for one fact, and characters in a fact's sentence.
export const MAX_FACTS = 8, MAX_QUOTES = 3, MAX_TEXT = 300;

export type RawFact = { text: string; detail: string; metric: string; baseline: string; team: string; own_part: string; skills: string[]; kind: string; quotes: { turn: number; quote: string }[] };
export type Raw = Record<CarlPart, string> & { facts: RawFact[] };
// What is sent: the job for context, the project's name, and the owner's answers, word for word.
export type Request = { job: string; project: string; answers: { turn: number; part: string; question: string; followUp: string; answer: string }[] };

const FIELD = { type: 'string' };
export const SCHEMA = { type: 'object', additionalProperties: false, required: [...CARL, 'facts'], properties: {
  context: FIELD, action: FIELD, result: FIELD, learning: FIELD,
  facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'detail', 'metric', 'baseline', 'team', 'own_part', 'skills', 'kind', 'quotes'], properties: {
    text: FIELD, detail: FIELD, metric: FIELD, baseline: FIELD, team: FIELD, own_part: FIELD, skills: { type: 'array', items: FIELD }, kind: { type: 'string', enum: [...KINDS] },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['turn', 'quote'], properties: { turn: { type: 'integer' }, quote: FIELD } } } } } } } };

export type ProjectRow = { id: number; role_id: number | null; via_role: number | null; title: string; context: string; action: string; result: string; learning: string; derived: string };
type RoleLite = { id: number; title: string; company: string; start: string; end: string; part_of: number | null };
const roleOf = (id: number | null) => (id === null ? null : db.query('SELECT id, title, company, start, end, part_of FROM roles WHERE id = ?').get(id) as RoleLite | null);
const dates = (r: RoleLite) => (r.start === '' ? '' : `, ${r.start} to ${r.end === '' ? 'now' : r.end}`);

// The job a project belongs to, in words: its role's title, employer and dates; for a repository's project, the employer
// it was filed under; else the owner's own side project.
function jobOf(p: ProjectRow): string {
  const carrier = roleOf(p.via_role);
  const job = carrier ? roleOf(carrier.part_of) : roleOf(p.role_id);
  return job ? `${job.title ? `${job.title} at ` : ''}${job.company}${dates(job)}` : 'A side project of their own, not done for an employer';
}
export const projectRow = (id: number) => db.query('SELECT id, role_id, via_role, title, context, action, result, learning, derived FROM projects WHERE id = ?').get(id) as ProjectRow | null;
const nameOf = (p: ProjectRow) => roleOf(p.via_role)?.company ?? p.title;

export function requestFor(project: number, told: Told[]): Request {
  const p = projectRow(project)!;
  return { job: jobOf(p), project: nameOf(p), answers: told.map((t) => ({ turn: t.turn, part: t.part === '' || t.part === 'close' ? 'none' : t.part, question: t.question, followUp: t.followUp, answer: t.text })) };
}

export function prompt(r: Request): string {
  return `You are writing one person's account of one piece of their work, from what they said about it in an interview. They answered fixed questions by talking freely. You write the four parts of the story and a few facts from their answers.

The job, for context only: ${r.job}.
The piece of work, in their own words: ${r.project}.

The rules:
- Write only what the person said. Never invent, round up or infer a number, a name, a date, a tool or an outcome. A part the answers do not cover is "".
- The person talks freely. Asides, jokes, complaints, repetition and thinking aloud are not part of the record: leave them out. Do not report every line. Keep what a hiring manager would need to understand the work: the setting and what was at stake, what the person themselves did and decided, what changed, and what they learned.
- Keep the person's own words for the things that matter where they are plain and exact. Do not polish them into resume language, and do not add adjectives or adverbs they did not use.
- Write each number in the same form the person said it: digits as digits and words as words.

The four parts, each one to three plain sentences in the first person, or "" when the answers do not cover it:
- "context": the setting, scope or challenge.
- "action": what the person themselves did. Never what "we" did, unless they said what their own part was.
- "result": what changed, with each number exactly as they said it.
- "learning": what they say they learned or would do differently.

The facts, in "facts". A fact is one true sentence in the past tense with no leading pronoun, about one discrete thing the person did or achieved, that could stand as evidence behind a resume line. Return few strong facts, not many weak ones: at most ${MAX_FACTS}, and none when nothing stands out. For each:
- "text": the sentence.
- "detail": the story behind it in a sentence or two, in their words, or "".
- "metric": the measured result exactly as said, else "".
- "baseline": the number before, "team": who worked on it, "own_part": what the person did themselves; each only as said, else "".
- "skills": the tools, languages and platforms the person named as used in this work.
- "kind": one of ${KINDS.map((k) => `"${k}"`).join(', ')}.
- "quotes": one to ${MAX_QUOTES} passages that show the person said it. Each is the "turn" of one answer and a short passage copied character for character from that answer.

The wording rules, for the parts and the facts:
${WRITING}

The answers, as JSON. Each has its turn, the part of the story its question was asking about ("none" for a closing question), the question, the follow-up it answers ("" for none) and the answer exactly as given:
${JSON.stringify(r.answers)}`;
}

// ---------- The checks, in code ----------

export type Quote = { turn: number; start: number; end: number; quote: string };
export type CheckedFact = { text: string; detail: string; metric: string; baseline: string; team: string; own_part: string; skills: string[]; kind: string; quotes: Quote[] };
// What was left out, and why. quote: no passage of three words or more it quoted was in the answer it named, or its
// passages hold none of the words or numbers that say what it is. number: it held a number the owner did not say
// about this project. shape: empty, too long, or of no known kind. same: it said what another fact already says.
// deleted: the owner deleted the same words before. many: past the most one story keeps. parts: the parts not written,
// because they held a number the owner did not say.
export type Left = { quote: number; number: number; shape: number; same: number; deleted: number; many: number; parts: CarlPart[] };
// parts: each part's new words, or null when it is not written. said: every answer read, for the numbers they hold.
export type Checked = { parts: Record<CarlPart, string | null>; facts: CheckedFact[]; left: Left; said: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// A passage that would start or end inside a character written as two code units.
const cut = /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/;
const wordsOf = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

// The numbers deriving may write, read more strictly than a resume's check (lib/numbers.ts): every run of digits, with
// its magnitude ("50k", "$2.5M", "3 million") and its unit sign, and every number or quantity word. Years, dates,
// durations, versions and digit ordinals ("1st") are numbers too; ordinal words ("first", "second") are not.
const DIGITS = /([$€£¥])?\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|mm|m|bn|b)(?![\p{L}\p{N}]))?(?:\s(thousand|million|billion)\b)?(?:\s?(%|per ?cent\b|percent\b|x\b|×|times\b))?/giu;
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands',
  'million', 'millions', 'billion', 'billions', 'dozen', 'dozens', 'half', 'halve', 'halved', 'halving', 'quarter', 'third', 'double', 'doubled', 'doubling',
  'triple', 'tripled', 'tripling', 'quadruple', 'quadrupled', 'twice', 'couple']);
const isNumberWord = (w: string) => NUMBER_WORDS.has(w) || /fold$/.test(w) && w !== 'fold';
const unitOf = (money: string | undefined, sign: string | undefined) => (money ? `money${money}` : !sign ? '' : /%|cent/i.test(sign) ? 'percent' : 'times');
// A magnitude in one form: k or thousand, m, mm or million, b, bn or billion.
const magnitudeOf = (suffix: string | undefined, word: string | undefined) => {
  const m = (suffix ?? word ?? '').toLowerCase();
  return m === '' ? '' : m === 'k' || m === 'thousand' ? 'k' : m === 'b' || m === 'bn' || m === 'billion' ? 'b' : 'm';
};
const numbersOf = (s: string) => [...s.matchAll(DIGITS)].map((m) => ({ said: m[0].trim(), key: `${m[2].replace(/,/g, '').replace(/\.0+$/, '')}${magnitudeOf(m[3], m[4])}|${unitOf(m[1], m[5])}` }));
// The numbers and number words in a text that the owner's answers about this project do not hold in the same form:
// digits with the same magnitude and unit sign, a number word as the same word. Each as it stands in the text.
export const numbersNotSaid = (said: string) => {
  const digits = new Set(numbersOf(said).map((n) => n.key)), words = new Set(wordsOf(said));
  return (s: string): string[] => [...new Set([...numbersOf(s).filter((n) => !digits.has(n.key)).map((n) => n.said), ...wordsOf(s).filter((w) => isNumberWord(w) && !words.has(w))])];
};
export const notSaidIn = (said: string) => {
  const notSaid = numbersNotSaid(said);
  return (s: string) => s !== '' && notSaid(s).length > 0;
};
// Words that say nothing about what a fact is, among those of four letters or more.
const STOP = new Set('that this with from have were they them their there what when which into over about also been more than then each very some just only your after before while where would could should other these those because them used using made make like much many most such well'.split(' '));
// Whether a fact's quotes hold one of the words that say what it is (four letters or more, not a stop word), or one of
// its numbers: a quote that shows the owner said something, but not this, proves nothing.
function quotesHold(text: string, quotes: Quote[]): boolean {
  const held = new Set(quotes.flatMap((q) => wordsOf(q.quote)));
  return wordsOf(text).some((w) => held.has(w) && (/^\d/.test(w) || (w.length >= 4 && !STOP.has(w))));
}
// A skill named as whole words in the owner's answers.
const named = (skill: string, said: string) => new RegExp(`(?<![\\p{L}\\p{N}])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(said);

// Checks a model's answer against the owner's answers about this project. Nothing is repaired by a guess: a fact that
// fails a check is dropped whole, a part that fails one is not written, and a skill that fails one is left off.
export function checkDerived(raw: Raw, told: Told[]): Checked {
  const said = told.map((t) => t.text).join('\n'), byTurn = new Map(told.map((t) => [t.turn, t.text]));
  const notSaid = notSaidIn(said);
  const left: Left = { quote: 0, number: 0, shape: 0, same: 0, deleted: 0, many: 0, parts: [] };
  const parts = Object.fromEntries(CARL.map((k) => {
    const v = str(raw?.[k]);
    if (notSaid(v)) { left.parts.push(k); return [k, null]; }
    return [k, v];
  })) as Record<CarlPart, string | null>;
  const facts: CheckedFact[] = [], seen = new Set<string>();
  for (const f of Array.isArray(raw?.facts) ? raw.facts : []) {
    const text = str(f?.text), kind = str(f?.kind);
    if (text === '' || text.length > MAX_TEXT || !(KINDS as readonly string[]).includes(kind)) { left.shape++; continue; }
    // A quote is at least three words, found character for character in the answer of the turn it names.
    const quotes: Quote[] = [];
    for (const q of Array.isArray(f.quotes) ? f.quotes : []) {
      const answer = byTurn.get(Number(q?.turn)), quote = typeof q?.quote === 'string' ? q.quote : '';
      if (answer === undefined || wordsOf(quote).length < 3 || cut.test(quote)) continue;
      const start = answer.indexOf(quote);
      if (start < 0 || checkSpan(answer, { start, end: start + quote.length, quote }).state !== 'holds') continue;
      if (!quotes.some((x) => x.turn === Number(q.turn) && x.start === start)) quotes.push({ turn: Number(q.turn), start, end: start + quote.length, quote });
    }
    if (quotes.length === 0 || !quotesHold(text, quotes)) { left.quote++; continue; }
    const fields = { text, detail: str(f.detail), metric: str(f.metric), baseline: str(f.baseline), team: str(f.team), own_part: str(f.own_part) };
    if (Object.values(fields).some(notSaid)) { left.number++; continue; }
    if (seen.has(norm(text))) { left.same++; continue; }
    seen.add(norm(text));
    const skills: string[] = [];
    for (const k of (Array.isArray(f.skills) ? f.skills : []).map(str)) {
      if (k !== '' && named(k, said) && !notSaid(k) && !skills.some((x) => x.toLowerCase() === k.toLowerCase())) skills.push(k);
    }
    facts.push({ ...fields, skills, kind, quotes: quotes.slice(0, MAX_QUOTES) });
  }
  left.many = Math.max(0, facts.length - MAX_FACTS);
  return { parts, facts: facts.slice(0, MAX_FACTS), left, said };
}

// What was left out, in plain sentences for the Activity row and the project ('' when nothing was).
export function leftNote(left: Left): string {
  const facts = (n: number, why1: string, whyMany: string) => (n === 0 ? [] : [n === 1 ? `1 fact was left out: it ${why1}.` : `${n} facts were left out: ${whyMany}.`]);
  const names = left.parts.map((k) => `the ${PART_NAMES[k].toLowerCase()}`);
  const parts = names.length === 0 ? [] : [`${(names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`).replace(/^t/, 'T')} ${names.length === 1 ? 'was' : 'were'} not written: ${names.length === 1 ? 'it' : 'each'} held a number you did not say.`];
  return [
    ...parts,
    ...facts(left.number, 'held a number you did not say', 'each held a number you did not say'),
    ...facts(left.quote, 'quoted none of your words that show it', 'each quoted none of your words that show it'),
    ...facts(left.shape, 'was empty, too long or of no known kind', 'each was empty, too long or of no known kind'),
    ...facts(left.same, 'said what another fact already says', 'each said what another fact already says'),
    ...facts(left.deleted, 'had the words of a fact you deleted', 'each had the words of a fact you deleted'),
    ...facts(left.many, `was past the ${MAX_FACTS} a story keeps`, `they were past the ${MAX_FACTS} a story keeps`),
  ].join(' ');
}

// ---------- What is written ----------

// Where a project's facts are filed (as lib/record.ts files a fact added to it): in the project and its role, or, for a
// project carried by a roles row, in that row.
export const homeOf = (p: ProjectRow) => (p.via_role !== null ? { role_id: p.via_role, project_id: null } : { role_id: p.role_id, project_id: p.id });
const parsed = (s: string): Partial<Record<CarlPart, string>> => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

// Writes a checked answer, in one transaction, only if the project still exists. toldAt: when the latest answer read
// was given. Returns the note of what was left out, or null when the project is gone.
export function writeDerived(project: number, c: Checked, toldAt: number, now: number): string | null {
  return db.transaction((): string | null => {
    const p = projectRow(project);
    if (!p) return null;
    const before = parsed(p.derived), after: Partial<Record<CarlPart, string>> = {};
    for (const k of CARL) {
      // A part the owner typed, edited or cleared is theirs: only one still as deriving last wrote it is written, and an
      // empty one that deriving never wrote. An empty part that deriving wrote before was cleared by the owner.
      const was = before[k] ?? '', mine = p[k] !== was;
      // A part refused for a number is not written; what deriving wrote before stays only while the answers still hold
      // its numbers (an answer may have been deleted since).
      const v = c.parts[k] ?? (mine || !notSaidIn(c.said)(was) ? null : '');
      if (v === null || mine) { after[k] = was; continue; }
      if (p[k] !== v) db.query(`UPDATE projects SET ${k} = ? WHERE id = ?`).run(v, project);
      after[k] = v;
    }
    const home = homeOf(p), where = home.project_id === null ? 'role_id = ? AND project_id IS NULL' : 'role_id IS ? AND project_id = ?';
    const at = home.project_id === null ? [home.role_id] : [home.role_id, home.project_id];
    db.query(`DELETE FROM facts WHERE told = 1 AND status = 'proposed' AND ${where}`).run(...at);
    const kept = new Set((db.query("SELECT text FROM facts WHERE status = 'confirmed'").all() as { text: string }[]).map((f) => norm(f.text)));
    const deleted = new Set((db.query('SELECT text FROM deleted_facts').all() as { text: string }[]).map((f) => f.text));
    const left = { ...c.left };
    for (const f of c.facts) {
      const key = norm(f.text);
      if (kept.has(key)) { left.same++; continue; }
      if (deleted.has(key)) { left.deleted++; continue; }
      const made = db.query(`INSERT INTO facts (id, role_id, project_id, kind, text, detail, metric, skills, evidence, source_id, status, created_at, baseline, team, own_part, told)
        VALUES (${nextId('facts')}, ?, ?, ?, ?, ?, ?, ?, '', NULL, 'proposed', ?, ?, ?, ?, 1) RETURNING id`)
        .get(home.role_id, home.project_id, f.kind, f.text, f.detail, f.metric, f.skills.join(', '), now, f.baseline, f.team, f.own_part) as { id: number };
      for (const q of f.quotes) {
        const o = addOrigin(made.id, { kind: 'told', refId: q.turn, start: q.start, end: q.end }, now);
        if (!o.ok) throw new Error(o.error);
      }
      kept.add(key);
    }
    db.query('UPDATE projects SET derived = ?, told_at = ? WHERE id = ?').run(JSON.stringify(after), toldAt, project);
    return leftNote(left);
  }).immediate();
}

// ---------- Asking, and the worker's part ----------

// The owner asks for the story to be written again. '' when queued, else why not.
export function askDerive(project: number): string {
  const p = db.query('SELECT derive_status FROM projects WHERE id = ?').get(project) as { derive_status: string } | null;
  if (!p) return 'That project is no longer in your record.';
  if (p.derive_status === 'queued' || p.derive_status === 'running') return 'The story is being written now.';
  if (!hasSaid(project)) return 'Nothing has been told about this project yet.';
  queueDerive(project);
  return '';
}

const NOTHING: Raw = { context: '', action: '', result: '', learning: '', facts: [] };

// One project: the request, the checks against the answers as they are once the model has answered (one deleted
// meanwhile no longer counts), and the write. With nothing told, no model is asked: what deriving wrote is cleared.
// Returns the note of what was left out.
export async function deriveFor(project: number, cwd: string, now = () => Date.now()): Promise<string> {
  setStage('derive-story', project, 'Reading what you said');
  const told = toldAbout(project);
  let raw = NOTHING;
  if (told.length > 0) {
    setStage('derive-story', project, 'Writing the four parts');
    raw = await ask<Raw>({ cwd, schema: SCHEMA, prompt: prompt(requestFor(project, told)), timeoutMs: 10 * 60_000, model: process.env.EGG_DERIVE_MODEL ?? process.env.EGG_MODEL ?? 'opus' });
  }
  setStage('derive-story', project, 'Checking it against your words');
  const fresh = toldAbout(project);
  return writeDerived(project, checkDerived(raw, fresh), Math.max(0, ...fresh.map((t) => t.at)), now()) ?? '';
}

// The worker's whole step for one queued project: running, then done (with what was left out) or failed (with why).
// The status column moves the activity log. A failure changes nothing in the record. Asked again while it ran, it
// stays queued and is taken again.
export async function runQueued(cwd: string, now = () => Date.now()): Promise<boolean> {
  const p = db.query("SELECT id FROM projects WHERE derive_status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | null;
  if (!p) return false;
  db.query("UPDATE projects SET derive_status = 'running', derive_note = '' WHERE id = ?").run(p.id);
  try {
    const note = await deriveFor(p.id, cwd, now);
    db.query("UPDATE projects SET derive_status = 'done', derive_note = ? WHERE id = ? AND derive_status = 'running'").run(note, p.id);
    console.log(`derive: project ${p.id} written${note ? `; ${note}` : ''}`);
  } catch (e) {
    db.query("UPDATE projects SET derive_status = 'failed', derive_note = ? WHERE id = ? AND derive_status = 'running'").run((e as Error).message, p.id);
    console.log(`derive: failed: ${(e as Error).message}`);
  }
  return true;
}
