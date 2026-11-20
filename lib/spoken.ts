// The spoken story (DESIGN.md section 12): one text the owner would say aloud in an interview about one project, in
// the first person and in CARL order. Never on its own: the owner asks for it ("Write the spoken story"), the worker
// makes one model request, and code checks the text before it is stored. Every number must stand, in the same form, in
// what the owner said about the project or in its four parts and facts as they stand (the strict check of deriving,
// lib/derive.ts); a text over REFUSE_WORDS words, or with a line that looks like a heading or a list, is refused. A
// refused text is asked for once more with the reason; refused again, it is not stored, and the Activity row says why.
//
// What is written never overwrites the owner: the text is written only while it still holds what the writer last wrote
// (projects.spoken_wrote). A text the owner typed, edited or cleared is theirs. Writing it again then changes nothing,
// so it is refused until the owner chooses to replace their edit (projects.spoken_replace), which lets one text that
// passes the checks replace it; a failure takes that back, so the owner's text is protected again.
//
// The time a text takes to say is counted here, from its words, at WORDS_PER_MINUTE.
import { db } from './db.ts';
import { ask } from './llm.ts';
import { setStage } from './activity.ts';
import { WRITING } from './writing.ts';
import { CARL, homeOf, numbersNotSaid, projectRow, requestFor, type CarlPart } from './derive.ts';
import { hasSaid, toldAbout } from './sittings.ts';

// The pace a story is said at, in words a minute; the time to aim under, in seconds; the words the model is asked to stay
// under; and the words past which a text is refused.
export const WORDS_PER_MINUTE = 140, AIM_SECONDS = 210, MAX_WORDS = 450, REFUSE_WORDS = 520;

// ---------- The time it takes to say ----------

// The words of a text: each run of letters or digits, with what is joined to it ("don't" is one word).
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// How long a text takes to say at the pace, rounded to 10 seconds (10 at the least); 0 for no text.
export const spokenSeconds = (s: string) => (wordCount(s) === 0 ? 0 : Math.max(10, Math.round((wordCount(s) * 60) / WORDS_PER_MINUTE / 10) * 10));
// A time in words: "2 min 40 s", "3 min 05 s", "50 s".
export function timeWords(seconds: number): string {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return m === 0 ? `${s} s` : `${m} min ${String(s).padStart(2, '0')} s`;
}
// The line under a spoken story: about how long it takes, the aim when it is over, and the last measured time, if any.
// over: it is past the aim, and the line is drawn as a warning.
export function timeLine(text: string, lastTimed: number | null): { line: string; over: boolean } {
  const seconds = spokenSeconds(text), over = seconds > AIM_SECONDS;
  const timed = lastTimed === null ? '' : ` Last timed at ${timeWords(lastTimed)}.`;
  return { line: `About ${timeWords(seconds)} when spoken.${over ? ` Aim for ${timeWords(AIM_SECONDS)} or less.` : ''}${timed}`, over };
}

// ---------- What the model is given ----------

type Parts = Record<CarlPart, string>;
type FactLine = { text: string; detail: string; metric: string; baseline: string; team: string; own_part: string };
// What is sent: the job, the project's name, its four parts and facts as they stand, and every answer about it.
export type SpokenRequest = { job: string; project: string; parts: Parts; facts: FactLine[]; answers: { question: string; followUp: string; answer: string }[] };

const partsOf = (project: number): Parts | null => {
  const p = projectRow(project);
  return p ? (Object.fromEntries(CARL.map((k) => [k, p[k]])) as Parts) : null;
};
function factsOf(project: number): FactLine[] {
  const p = projectRow(project);
  if (!p) return [];
  const home = homeOf(p);
  return db.query(`SELECT text, detail, metric, baseline, team, own_part FROM facts WHERE ${home.project_id === null ? 'role_id = ? AND project_id IS NULL' : 'project_id = ?'} ORDER BY id`)
    .all(home.project_id === null ? home.role_id : home.project_id) as FactLine[];
}

export function spokenRequest(project: number): SpokenRequest {
  const r = requestFor(project, toldAbout(project));
  return { job: r.job, project: r.project, parts: partsOf(project)!, facts: factsOf(project), answers: r.answers.map((a) => ({ question: a.question, followUp: a.followUp, answer: a.answer })) };
}

export const SCHEMA = { type: 'object', additionalProperties: false, required: ['spoken'], properties: { spoken: { type: 'string' } } };

export function prompt(r: SpokenRequest): string {
  return `You are helping one person get ready for a job interview. Write what they would say aloud to an interviewer about one piece of their work, from what they said about it and from the story of it in their record.

The job, for context only: ${r.job}.
The piece of work: ${r.project}.

What to write:
- One text that the person says aloud: first person, past tense, plain spoken sentences. In this order: the context in two or three sentences; what they themselves did and decided, which is the longest part; the result; and what they learned, in one or two sentences.
- No headings, no lists and no labels. Plain paragraphs only.
- Use only what the person said in the answers and what the parts and facts below state. Never invent, round up or infer a number, a name, a date, a tool or an outcome. Write each number in the form the person gave it: digits as digits and words as words.
- Keep the person's own voice. Where their answers have a plain, vivid phrase of their own, use it. Leave out asides, repetition and thinking aloud.
- Do not add praise of the person, adjectives or adverbs they did not use, or a closing line about what a good fit they are.
- Length: at most ${MAX_WORDS} words, so that it can be said in under three and a half minutes. Shorter is better when the answers are thin. If there is not enough for a part, leave that part out. Do not pad.

The wording rules below are written for everything the studio writes. A spoken story may use "I" and "we": say "I" for what the person did themselves, and "we" only for what a team did together.
${WRITING}

The story as it stands in their record, as JSON: its four parts ("" for a part not written) and its facts.
${JSON.stringify({ parts: r.parts, facts: r.facts })}

Every answer the person gave about this piece of work, as JSON, word for word: the question, the follow-up it answers ("" for none) and the answer exactly as given.
${JSON.stringify(r.answers)}

Return the text in "spoken".`;
}

// ---------- The checks, in code ----------

// Everything a spoken story may take a number from: the owner's answers about the project, and its parts and facts as
// they stand now (a number the owner typed into a part is the owner's own).
export function saidAbout(project: number): string {
  const parts = partsOf(project);
  return [...toldAbout(project).map((t) => t.text), ...(parts ? CARL.map((k) => parts[k]) : []), ...factsOf(project).flatMap((f) => Object.values(f))].join('\n');
}

// The first line that is a heading, a list item, a quotation mark of Markdown or a label rather than spoken sentences:
// a "#" heading; a list mark ("-", "*", "•", "+", "1.") or a quote mark (">") at the start (a spoken dash, "–" or "—",
// is speech); Markdown bold or italic marks; a part's name with a colon; a line that ends with a colon, unless a
// quotation follows it; or a few words with no closing mark, followed by a blank line. undefined when there is none.
const LABEL = /^(context|action|result|learning|situation|task|what i learned|what i did)\b[^.!?]{0,20}:/i;
const QUOTE = /^["“‘']/;
export function headingLine(text: string): string | undefined {
  const lines = text.split('\n');
  return lines.find((line, i) => {
    const l = line.trim(), next = (lines[i + 1] ?? '').trim();
    if (l === '') return false;
    if (/^(#|[-*•+>](\s|$)|\d{1,2}[.)]\s)/.test(l) || /(\*\*|__)\S.*?\1/.test(l) || /(^|\s)[*_]\S[^*_]*[*_](?=\s|[.,;:!?]|$)/.test(l) || LABEL.test(l)) return true;
    if (/:$/.test(l)) return !QUOTE.test(next);
    return wordCount(l) <= 6 && !/[.!?…"”’)]$/.test(l) && i + 1 < lines.length && next === '';
  })?.trim();
}

// Why a text was refused, in plain words for the owner; null when it passes. Nothing is repaired: it is refused whole.
export type SpokenCheck = { ok: true; text: string } | { ok: false; why: string };
const tidy = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : '');
const andList = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
export function checkSpoken(raw: unknown, said: string): SpokenCheck {
  const text = tidy(raw);
  if (text === '') return { ok: false, why: 'Nothing was written.' };
  const words = wordCount(text);
  if (words > REFUSE_WORDS) return { ok: false, why: `It was ${words} words, over the ${REFUSE_WORDS} a spoken story may have.` };
  const heading = headingLine(text);
  if (heading !== undefined) return { ok: false, why: `It had a line that looks like a heading or a list: “${heading}”.` };
  const numbers = numbersNotSaid(said)(text);
  if (numbers.length > 0) return { ok: false, why: `It held ${numbers.length === 1 ? 'a number' : 'numbers'} you did not say: ${andList(numbers.map((n) => `“${n}”`))}.` };
  return { ok: true, text };
}

// ---------- What is stored ----------

type SpokenRow = { spoken: string; spoken_wrote: string; spoken_replace: number; spoken_status: string; derive_status: string };
const rowOf = (project: number) => db.query('SELECT spoken, spoken_wrote, spoken_replace, spoken_status, derive_status FROM projects WHERE id = ?').get(project) as SpokenRow | null;
// Whether the text is the owner's: typed, edited or cleared since the writer last wrote it.
export const heldByOwner = (r: { spoken: string; spoken_wrote: string }) => r.spoken !== r.spoken_wrote;

// Writes a checked text only while the text is still the writer's, or the owner asked for theirs to be replaced (which
// it then no longer asks). Returns whether it was written, kept (the owner's), or the project is gone.
export function writeSpoken(project: number, text: string): 'written' | 'kept' | 'gone' {
  return db.transaction((): 'written' | 'kept' | 'gone' => {
    const r = rowOf(project);
    if (!r) return 'gone';
    if (heldByOwner(r) && r.spoken_replace !== 1) return 'kept';
    db.query('UPDATE projects SET spoken = ?, spoken_wrote = ?, spoken_replace = 0 WHERE id = ?').run(text, text, project);
    return 'written';
  }).immediate();
}

// The owner's own text, typed or edited in place ('' clears it). Saved while the story is being written, it is kept over
// what the writer then writes: a new edit takes back an earlier request to replace the text. '' when saved, else why not.
export function saveSpoken(project: number, text: unknown): string {
  if (typeof text !== 'string') return 'Send the spoken story as text.';
  const r = rowOf(project);
  if (!r) return 'That project is no longer in your record.';
  db.query('UPDATE projects SET spoken = ?, spoken_replace = 0 WHERE id = ?').run(text.trim().replace(/\r\n?/g, '\n'), project);
  return '';
}

// Whether a project has anything to tell: an answer from telling, or one of its four parts.
export const hasStory = (project: number) => hasSaid(project) || CARL.some((k) => (partsOf(project)?.[k] ?? '').trim() !== '');

export const HELD = 'You changed this spoken story yourself, so writing it again would change nothing. Choose Replace my edit to have it written again.';
export const DERIVING = 'The story is being written from what you said. Ask again when it is done.';
// The owner asks for the spoken story to be written. With `replace`, a text the owner holds may be replaced, once, by a
// text that passes the checks; until then it stays protected. While the story is being written from what the owner
// said, its parts may still hold a number from an answer since deleted, so it waits. '' when queued, else why not.
export function askSpoken(project: number, replace = false): string {
  return db.transaction((): string => {
    const r = rowOf(project);
    if (!r) return 'That project is no longer in your record.';
    if (r.spoken_status === 'queued' || r.spoken_status === 'running') return 'The spoken story is being written now.';
    if (r.derive_status === 'queued' || r.derive_status === 'running') return DERIVING;
    if (!hasStory(project)) return 'There is nothing to tell yet. Tell this project, or write its four parts, first.';
    if (heldByOwner(r) && !replace) return HELD;
    db.query("UPDATE projects SET spoken_replace = ?, spoken_status = 'queued', spoken_note = '' WHERE id = ?").run(heldByOwner(r) ? 1 : 0, project);
    return '';
  }).immediate();
}

// ---------- The worker's part ----------

const KEPT = 'Your own text was kept: you changed it while it was being written.';

// One project: the request, the model, the checks against what the owner said as it stands once the model has
// answered, and the write. A refused text is asked for once more, with what was refused and why; refused again, it
// throws, so nothing is stored and the reason is the failure's. Returns the note.
export async function spokenFor(project: number, cwd: string): Promise<string> {
  setStage('write-spoken', project, 'Reading the story and what you said');
  if (!hasStory(project)) throw new Error('There is nothing to tell yet.');
  if (['queued', 'running'].includes(rowOf(project)?.derive_status ?? '')) throw new Error(DERIVING);
  const first = prompt(spokenRequest(project));
  const write = (text: string) => ask<{ spoken: string }>({ cwd, schema: SCHEMA, prompt: text, timeoutMs: 10 * 60_000, model: process.env.EGG_SPOKEN_MODEL ?? process.env.EGG_MODEL ?? 'opus' });
  setStage('write-spoken', project, 'Writing the spoken story');
  let raw = await write(first);
  setStage('write-spoken', project, 'Checking it against your words');
  let c = checkSpoken(raw?.spoken, saidAbout(project));
  if (!c.ok) {
    setStage('write-spoken', project, 'Writing it again');
    raw = await write(`${first}\n\nThe text you wrote before was refused, because a check in code found this: ${c.why} Write it again, keeping to every rule above.`);
    setStage('write-spoken', project, 'Checking it against your words');
    c = checkSpoken(raw?.spoken, saidAbout(project));
  }
  if (!c.ok) throw new Error(`The spoken story was not kept. ${c.why}`);
  return writeSpoken(project, c.text) === 'kept' ? KEPT : '';
}

// The worker's whole step for one queued project (the first, or the one named): running, then done or failed (with
// why). A failure changes nothing.
export async function runSpoken(cwd: string, only: number | null = null): Promise<boolean> {
  const p = db.query("SELECT id FROM projects WHERE spoken_status = 'queued' AND (?1 IS NULL OR id = ?1) ORDER BY id LIMIT 1").get(only) as { id: number } | null;
  if (!p) return false;
  db.query("UPDATE projects SET spoken_status = 'running', spoken_note = '' WHERE id = ?").run(p.id);
  try {
    const note = await spokenFor(p.id, cwd);
    db.query("UPDATE projects SET spoken_status = 'done', spoken_note = ? WHERE id = ? AND spoken_status = 'running'").run(note, p.id);
    console.log(`spoken: project ${p.id} written${note ? `; ${note}` : ''}`);
  } catch (e) {
    // A failure or a refused text takes back a request to replace the owner's text: it is protected again.
    db.query("UPDATE projects SET spoken_status = 'failed', spoken_note = ?, spoken_replace = 0 WHERE id = ? AND spoken_status = 'running'").run((e as Error).message, p.id);
    console.log(`spoken: failed: ${(e as Error).message}`);
  }
  return true;
}
