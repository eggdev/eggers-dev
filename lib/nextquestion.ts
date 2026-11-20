// The next question: one question at a time for the You screen, chosen by code from the questions already open. Not a
// store of its own: it reads three sources and orders them.
// 1. The agenda (lib/agenda.ts): what the saved postings ask for that the record has no story for, the most postings
//    first, then the project the last resumes lean on.
// 2. The record's gaps that ask for more story (lib/gaps.ts), in their own order: a job with no story, a project's
//    missing part, the number before and the owner's own part of a fact a job leans on. They are answered the way they
//    are everywhere else: where their item is.
// 3. Some of the questions a model wrote (openQuestions in lib/talk.ts), in that order: what a resume's writer could not
//    get from the bank, the profile's gaps, and what a posting's reading found missing. Never the six-second skim's
//    questions nor the council review's: they are a reader's reaction to a resume ("Two current jobs?", "Why is there a
//    gap?"), and ask the owner to account for dates and roles.
// Only these. Whitelists, of raised kinds and of Talk's sources, so a kind or source added later is never asked here by
// default: a question that asks the owner to confirm a fact, question a date, or settle two roles at once (the timeline,
// LinkedIn's titles, skills, a role's start, where a repository belongs, the skim) is never one of them.
//
// A question answered in words (the agenda's and the model's) goes into Talk as one exchange, so the bank learns from it
// the way it learns from anything said there: the question as the tool's turn (no model writes it), then the owner's
// words as their own turn, then a reply queued for the worker (say in lib/talk.ts), which records what they said as
// facts. Answered or skipped, a question is never asked again.
import { db } from './db.ts';
import { keyOf } from './queue.ts';
import { openRaised, settle, type Raised } from './raised.ts';
import { hasReplyInHand, openQuestions, say, type QuestionSource } from './talk.ts';

// Text questions are answered here. Record gaps are answered where their route leads.
export type Input = 'text' | 'route';
export type Candidate = { key: string; text: string; from: string; kind: 'agenda' | 'record' | 'talk'; input: Input; choices: string[]; inputs: string[]; route: string };

// The record's gaps that ask for story. Not the start date of a role, nor where a repository belongs.
const RECORD_ASKS = ['record:empty:', 'record:part:', 'record:baseline:', 'record:own:'];
export const asksForStory = (q: { kind: string; key: string }) => q.kind === 'agenda' || (q.kind === 'record' && RECORD_ASKS.some((p) => q.key.startsWith(p)));
// The sources of Talk's questions that ask for story. Not 'skim' nor 'review' (see 3 above).
export const TALK_SOURCES: ReadonlySet<QuestionSource> = new Set<QuestionSource>(['resume', 'profile', 'job']);
// The longest answer taken here, in characters.
export const MAX_WORDS = 20_000;
// Every question Talk has open, not only the first few that Talk shows.
const ALL = 10_000;
db.run(`CREATE TABLE IF NOT EXISTS profile_answers (
  id INTEGER PRIMARY KEY, question_key TEXT NOT NULL, question TEXT NOT NULL, words TEXT NOT NULL, at INTEGER NOT NULL
)`);
export const waitingAnswers = () => (db.query('SELECT count(*) AS n FROM profile_answers').get() as { n: number }).n;

// Words that put the owner's own account in doubt. The owner's rule: no question may ask them to confirm a fact,
// question a date, or point at overlapping roles. The questions code raises keep to it by kind (RECORD_ASKS above), and
// Talk's by source (TALK_SOURCES). A second layer on those: a question a model wrote is free text, so one from an
// allowed source that says any of these is not offered here.
// A guard, not a guarantee: a doubt worded otherwise gets through, and a fair question that happens to use one of these
// words is held back. A question held back is not answered or closed; it is only not asked on the You screen. Matched
// without regard to case, as whole words.
export const DOUBT: readonly RegExp[] = [
  /\b(confirm|confirms|confirmed|confirming|confirmation)\b/i,
  /\b(verify|verifies|verified|verifying|verification)\b/i,
  /\bis (it|that|this) (true|correct|right|accurate)\b/i,
  /\bwhich (date|one|is)\b[^.?!]*\b(right|correct)\b/i,
  /\b(overlap|overlaps|overlapped|overlapping)\b/i,
  /\bat the same time as\b/i,
  /\b(discrepancy|discrepancies)\b/i,
  /\binconsisten(t|cy|cies)\b/i,
  /\bshould be corrected\b/i,
];
export const doubts = (text: string) => DOUBT.some((re) => re.test(text));

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const fromAgenda = (q: Raised) => (q.data.kind === 'lean' ? `From your last ${num(q.data.resumes)} resumes` : `${num(q.data.count)} saved postings ask for this`);
const routeOfRecord = (q: Raised) => typeof q.data.route === 'string' ? q.data.route : '';

// Every question to ask, in the order to ask them.
export function candidates(): Candidate[] {
  const open = openRaised().filter(asksForStory);
  // The postings' terms by how many postings ask, then the leaning resumes.
  const agenda = open.filter((q) => q.kind === 'agenda')
    .sort((a, b) => Number(a.data.kind === 'lean') - Number(b.data.kind === 'lean') || num(b.data.count) - num(a.data.count) || a.key.localeCompare(b.key))
    .map((q): Candidate => ({ key: q.key, text: q.text, from: fromAgenda(q), kind: 'agenda', input: 'text', choices: [], inputs: [], route: '' }));
  const record = open.filter((q) => q.kind === 'record' && routeOfRecord(q) !== '').sort((a, b) => num(a.data.rank) - num(b.data.rank))
    .map((q): Candidate => ({ key: q.key, text: q.text, from: 'From your record', kind: 'record', input: 'route', choices: [], inputs: [], route: routeOfRecord(q) }));
  const talk = openQuestions(ALL).filter((q) => TALK_SOURCES.has(q.source) && !doubts(q.text)).map((q): Candidate => ({ key: `talk:${keyOf(q.text)}`, text: q.text, from: q.from, kind: 'talk', input: 'text', choices: [], inputs: [], route: '' }));
  return [...agenda, ...record, ...talk];
}

// The first question, and how many there are.
export function next(): { question: Candidate | null; open: number } {
  const all = candidates();
  return { question: all[0] ?? null, open: all.length };
}

// Closes a question for good: the agenda's in raised_questions, the model's in `answered`, as Talk itself closes them.
function close(c: Candidate, answer: string, now: number): string {
  if (c.kind === 'talk') { db.query('INSERT OR IGNORE INTO answered (question, at) VALUES (?, ?)').run(c.text, now); return ''; }
  return settle(c.key, answer, now);
}

// Move one answer into Talk when it can be followed by its own reply. The stored answer is
// removed in the same transaction that creates the exchange, so retrying after a crash is safe.
export const drainAnswer = db.transaction((): boolean => {
  if (hasReplyInHand()) return false;
  const queued = db.query('SELECT id, question, words, at FROM profile_answers ORDER BY id LIMIT 1')
    .get() as { id: number; question: string; words: string; at: number } | null;
  if (!queued) return false;
  db.query("INSERT INTO talk (who, body, created_at) VALUES ('claude', ?, ?)").run(queued.question, queued.at);
  const refused = say(queued.words, queued.at);
  if (refused) throw new Error(refused);
  db.query('DELETE FROM profile_answers WHERE id = ?').run(queued.id);
  return true;
});

// Close the question and store the owner's words atomically. Talk can read them when idle.
export function answerText(key: string, words: string, now: number): string {
  if (words.trim() === '') return 'Write your answer, or skip the question.';
  if (words.length > MAX_WORDS) return `Keep your answer under ${MAX_WORDS.toLocaleString('en-US')} characters. Say the rest in Talk.`;
  return db.transaction((): string => {
    const c = candidates().find((x) => x.key === key);
    if (!c) return 'That question is no longer open.';
    if (c.input === 'route') return 'This question is answered where it leads.';
    const refused = close(c, words.trim(), now);
    if (refused) return refused;
    db.query('INSERT INTO profile_answers (question_key, question, words, at) VALUES (?, ?, ?, ?)').run(c.key, c.text, words, now);
    drainAnswer();
    return '';
  }).immediate();
}

// The owner skips a question: it is closed with no words and nothing in Talk.
export function skip(key: string, now: number): string {
  return db.transaction(() => {
    const c = candidates().find((x) => x.key === key);
    return c ? close(c, 'Skipped', now) : 'That question is no longer open.';
  }).immediate();
}
