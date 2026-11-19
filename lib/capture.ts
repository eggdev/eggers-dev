// Capture: an interview about one role or one project per sitting, one question at a time. The owner's answers are
// kept word for word; lib/sittings.ts stores them. This file is pure: the questions, the follow-ups and the choice of
// what to say next. Nothing here reads the database or asks a model.
//
// The interviewer says only fixed words: the opening line, the fifteen questions below (in a job's or a project's
// wording), the four fixed follow-up sentences, the reminder of the piece of work picked earlier, and the closing
// lines. The owner's answers are the only free text. A model-written interviewer was tried and dropped: a word-list
// check could not hold a model to the rules (see checkTurn), and research for this project found that tailored
// follow-ups drew no more words from people than a fixed one.
//
// A known limit of this version: one piece of work per role or project. The "pick" question is asked once, and every
// later question is about that piece of work, in every sitting about the same role or project.

export const SUBJECT_KINDS = ['role', 'project'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

// The part of a story each question fills.
export const PARTS = ['setting', 'the work', 'before', 'own part', 'choice', 'hard part', 'result', 'people', 'what others said', 'another view', 'went wrong', 'learned', 'close'] as const;
export type Part = (typeof PARTS)[number];

// The questions, the most important first. A sitting asks them in this order and skips any already answered or
// closed for the same role or project. The words come from interview research; keep them plain. Each is one ask, and
// passes checkTurn. "project" is the wording for a sitting about a project, for every question that speaks of the job.
export const QUESTIONS = [
  { key: 'setting', part: 'setting', text: 'Tell me about this job and your role in it.', project: 'Tell me about this project and your part in it.' },
  { key: 'pick', part: 'the work', text: 'Pick one piece of work from this job that you remember well.', project: 'Pick one part of this project that you remember well.' },
  { key: 'before', part: 'before', text: 'Take me back to the start. What was happening just before you got involved?' },
  { key: 'own-part', part: 'own part', text: 'What did you do yourself on this?' },
  { key: 'normal-week', part: 'own part', text: 'Picture a normal week in the middle of it. What were you working on?' },
  { key: 'choice', part: 'choice', text: 'Tell me about a point where you had to choose between options.' },
  { key: 'hardest', part: 'hard part', text: 'What was the hardest part? Tell me what happened.' },
  // The next question asks for the number, date or user that shows the change.
  { key: 'changed', part: 'result', text: 'What changed because of this work?' },
  { key: 'evidence', part: 'result', text: "Is there a number, a date or a user that shows it? If you don't know one, say so." },
  { key: 'people', part: 'people', text: 'Who did you work with on this?' },
  { key: 'said', part: 'what others said', text: 'Did anyone say something about the work at the time?' },
  { key: 'other-view', part: 'another view', text: "Tell it again from your manager's or a teammate's seat. What did they see?" },
  { key: 'went-wrong', part: 'went wrong', text: 'Tell me about a time something at this job went wrong.', project: 'Tell me about a time something on this project went wrong.' },
  { key: 'learned', part: 'learned', text: 'What did you learn here?', project: 'What did you learn from this project?' },
  { key: 'missed', part: 'close', text: "What should I have asked that I didn't?" },
] as const satisfies readonly { key: string; part: Part; text: string; project?: string }[];
export type QuestionKey = (typeof QUESTIONS)[number]['key'];
export type Question = (typeof QUESTIONS)[number];

// The first and last lines of a sitting. The opening says plainly that the questions are a fixed list (no model writes
// them, and DESIGN.md rule 10 keeps models off screens) and that the owner's words are
// kept as given. The closing says whether anything is left for a later sitting.
export const OPENING = 'These questions are a fixed list. They come one at a time, about one piece of your work. Your answers are kept exactly as you give them, word for word.';
export const CLOSING_DONE = 'That is the last question about this. Your answers are saved word for word.';
export const CLOSING_PAUSED = 'We will stop here for now. Your answers are saved word for word, and the next sitting starts with the questions not yet answered.';

// A later sitting says which piece of work the owner picked, in their own words, before it goes on. It is the one
// place the interviewer repeats the owner's words, so it is a fixed frame around a quote of their answer to "pick"
// (canQuote says which answers can be quoted). Only spaces and line breaks are changed in the quote, to fit one line.
// A long answer is cut at a word boundary, or, with no space to cut at, between two characters as a reader sees them:
// never inside an emoji or a letter with its accent, so the stored line reads back as written.
export const REMINDER_QUOTE_CHARS = 120;
export function reminderText(picked: string): string {
  const flat = picked.trim().replace(/\s+/g, ' ');
  if (flat.length <= REMINDER_QUOTE_CHARS) return `We carry on with the piece of work you picked last time: “${flat}”`;
  // The longest run of whole characters that fits, then back to its last space if it has one.
  let fit = 0;
  for (const g of graphemes(flat)) { if (fit + g.length > REMINDER_QUOTE_CHARS) break; fit += g.length; }
  const space = flat[fit] === ' ' ? fit : flat.lastIndexOf(' ', fit);
  const quote = `${flat.slice(0, space > 0 ? space : fit).replace(/[\s,;:.]+$/, '')}…`;
  return `We carry on with the piece of work you picked last time: “${quote}”`;
}
// The characters of a text as a reader sees them. Without Intl.Segmenter, a surrogate pair is still kept whole.
function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
  return [...s];
}

export const question = (key: QuestionKey): Question => QUESTIONS.find((q) => q.key === key)!;
export const isQuestionKey = (s: string): s is QuestionKey => QUESTIONS.some((q) => q.key === s);
// The words of a question for this kind of sitting.
export function questionText(key: QuestionKey, subject: SubjectKind): string {
  const q = question(key);
  return subject === 'project' && 'project' in q ? q.project : q.text;
}

// ---- Follow-ups ----

// A follow-up only fills a gap in the answer just given.
// last-time: the answer is a summary or a habit. own-part: it says "we" and never "I". what-changed: a result with no
// change named. anchor: the owner does not remember; offer a way in, never an answer.
export const FOLLOW_UP_KINDS = ['last-time', 'own-part', 'what-changed', 'anchor'] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export const isFollowUpKind = (s: string): s is FollowUpKind => (FOLLOW_UP_KINDS as readonly string[]).includes(s);

// Each kind's fixed sentence, and the questions it applies to. "only" limits a kind to those questions; "skip" leaves
// some out. A normal week is a habit by design, and so is what a company or project does, so neither gets "last time".
// "What did you do" still follows the people question, where "we" alone hides the owner's part. Another person's view
// and what others said are about other people, so they get no "what did you do". The second result question asks for
// evidence, not a change.
export const FOLLOW_UPS: Record<FollowUpKind, { text: string; only?: readonly QuestionKey[]; skip?: readonly QuestionKey[] }> = {
  'last-time': { text: 'Think of the last time that happened. What did you do that time?', skip: ['setting', 'normal-week', 'missed'] },
  'own-part': { text: 'What was your own part in that?', skip: ['other-view', 'said', 'missed'] },
  'what-changed': { text: 'What was different afterwards?', only: ['changed'] },
  anchor: { text: 'Let us try another way in. Is there a place or a person you connect with it?' },
};

// When several gaps show at once, the first in this order is asked. "I don't know" and a bare "No" are checked before
// all of them. Not remembering comes next, since nothing else can be asked of a memory that is not there yet. A habit
// comes before "we": one real occasion first, then the owner's part in it.
export const FOLLOW_UP_ORDER: readonly FollowUpKind[] = ['anchor', 'last-time', 'own-part', 'what-changed'];

// Detection is only ever done on a copy: lower case, plain apostrophes. The stored words are never changed.
const plain = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'");
const words = (s: string) => plain(s).match(/[\p{L}\p{N}']+/gu) ?? [];
// The whole answer as a phrase: its words, without the filler that can surround "I don't know".
const FILLER = new Set(['honestly', 'really', 'just', 'sorry', 'um', 'uh', 'hmm', 'well', 'oh', 'genuinely', 'truly', 'tbh', 'lol']);
const phrase = (s: string) => words(s).filter((w) => !FILLER.has(w)).join(' ');
// For "I don't know": one leading "no" or "nope" or a leading "I'm afraid" may come off ("No, I don't know"),
// and so do trailing words that only point back at the question ("I don't know one", "no idea at all").
const DONT_KNOW_LEADS: readonly (readonly string[])[] = [["i'm", 'afraid'], ['im', 'afraid'], ['no'], ['nope']];
const DONT_KNOW_TAILS: readonly (readonly string[])[] = [['that', 'one'], ['of', 'one'], ['at', 'all'], ['one']];
// The phrase with each of those taken off, and the phrase as it is: "No idea" stays "no idea", "No, I don't know"
// also reads as "i don't know".
function dontKnowPhrases(s: string): string[] {
  const w = phrase(s).split(' ').filter(Boolean);
  const starts = [w, ...DONT_KNOW_LEADS.filter((lead) => w.length > lead.length && lead.every((x, i) => w[i] === x)).map((lead) => w.slice(lead.length))];
  return starts.map((v) => {
    for (let again = true; again;) {
      again = false;
      for (const tail of DONT_KNOW_TAILS) if (v.length > tail.length && tail.every((x, i) => v[v.length - tail.length + i] === x)) { v = v.slice(0, -tail.length); again = true; }
    }
    return v.join(' ');
  });
}
// An answer with no letter or digit ("?", "...", "🤷") says nothing in words. lib/sittings.ts refuses it, as it
// refuses an empty answer, so the owner can say "I don't know" in words instead; it is never stored as an answer.
export const hasWords = (answer: string): boolean => /[\p{L}\p{N}]/u.test(answer);

// "I don't know" and its close forms, as the whole answer. Saying it ends the question for good. A phrase inside a
// longer answer does not: "We had no idea it would work", "I don't know why, but users loved it" and "I couldn't say
// no to the client" are answers. The forms follow the ones lib/db.ts treats as "no value given" (NOTHING, beside
// saidValue), which this pure module cannot import; "none", "nothing" and "don't remember" are left out here, because
// a bare "None" is an answer and not remembering gets the anchor follow-up.
export const DONT_KNOW: ReadonlySet<string> = new Set([
  "i don't know", "don't know", 'i dont know', 'dont know', 'i do not know', 'do not know', 'not sure', "i'm not sure", 'im not sure', 'i am not sure',
  'no idea', 'i have no idea', 'no clue', 'i have no clue', 'not a clue', 'dunno', 'idk', 'unknown', "i can't say", 'i cannot say', "i couldn't say",
  "can't say", 'nothing comes to mind', 'no way of knowing', 'i have no way of knowing', "haven't a clue", "i haven't a clue", 'n a', 'na',
]);
export const isDontKnow = (answer: string): boolean => dontKnowPhrases(answer).some((p) => DONT_KNOW.has(p));

// A bare "No" (or "None", "Nobody") answers the question: it settles it, is not "I don't know", and leaves no gap to
// follow up.
// Matched after the filler is taken out, so "Not really." is "not".
export const BARE_NO: ReadonlySet<string> = new Set(['no', 'nope', 'none', 'nothing', 'nobody', 'no one', 'not', 'no not', 'not that i know of']);
export const isBareNo = (answer: string): boolean => BARE_NO.has(phrase(answer));

export const NOT_REMEMBER: readonly RegExp[] = [
  /\bi (?:really |honestly |just )?(?:don't|dont|do not|can't|cant|cannot|can not|couldn't|could not) (?:remember|recall)\b/,
  /\bi forget\b/, /\bi(?:'ve| have) forgotten\b/, /\b(?:it's|it is|it was) (?:all )?(?:a blur|fuzzy|hazy)\b/, /\bhard to remember\b/, /\bno memory of\b/,
];
export const HABIT: readonly RegExp[] = [
  /\busually\b/, /\bgenerally\b/, /\btypically\b/, /\bnormally\b/, /\btend(?:ed)? to\b/, /\b(?:i|we|they) would (?!say|guess|think|have|imagine|estimate|like)\w/,
  /\balways\b/, /\boften\b/, /\bmost of the time\b/, /\bin general\b/, /\bas a rule\b/, /\bevery (?:time|day|week|month)\b/,
];
export const WE = ['we', "we're", "we've", "we'd", "we'll", 'us', 'our', 'ours', 'ourselves'] as const;
export const I = ['i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'mine', 'myself'] as const;
// Words that name a change. Any digit counts too, since a number is how a change is usually given.
export const CHANGE: readonly RegExp[] = [
  /\d/, /%/, /\bchang(?:e|ed|es|ing)\b/, /\bdifferen(?:t|tly|ce)\b/, /\bwent (?:from|up|down)\b/, /\bcut\b/, /\breduc(?:e|ed|ing)\b/, /\bincreas(?:e|ed|ing)\b/,
  /\bgr[eo]w(?:n)?\b/, /\bdropped\b/, /\bfell\b/, /\brose\b/, /\bsaved?\b/, /\bfaster\b/, /\bslower\b/, /\bfewer\b/, /\bmore\b/, /\bless\b/,
  /\bdoubled\b/, /\bhalved\b/, /\btripled\b/, /\bimproved?\b/, /\bbetter\b/, /\bworse\b/, /\bnow\b/, /\bafterwards?\b/, /\bno longer\b/,
  /\bstopped\b/, /\bstarted\b/, /\breplaced\b/, /\bremoved\b/, /\bunlike before\b/,
];

const any = (rs: readonly RegExp[], s: string) => rs.some((r) => r.test(s));

// Which gaps an answer shows, before any limit is applied: every kind whose pattern matches, in FOLLOW_UP_ORDER.
export function gapsIn(key: QuestionKey, answer: string): FollowUpKind[] {
  const s = plain(answer), w = new Set(words(answer));
  const found = new Set<FollowUpKind>();
  if (any(NOT_REMEMBER, s)) found.add('anchor');
  if (any(HABIT, s)) found.add('last-time');
  if (WE.some((x) => w.has(x)) && !I.some((x) => w.has(x))) found.add('own-part');
  if (question(key).part === 'result' && !any(CHANGE, s)) found.add('what-changed');
  return FOLLOW_UP_ORDER.filter((k) => found.has(k) && applies(k, key));
}
const applies = (kind: FollowUpKind, key: QuestionKey) => {
  const f = FOLLOW_UPS[kind];
  return (f.only === undefined || f.only.includes(key)) && !(f.skip ?? []).includes(key);
};

// The follow-up to ask after this answer, or null. asked is the kinds already asked on this question in this sitting:
// its length is how many follow-ups were asked, and a kind is never asked twice on one question. "I don't know" and a
// bare "No" always give null.
export function followUpFor(key: QuestionKey, answer: string, asked: readonly FollowUpKind[] = [], max = LIMITS.maxFollowUps): FollowUpKind | null {
  if (asked.length >= max || !hasWords(answer) || isDontKnow(answer) || isBareNo(answer)) return null;
  return gapsIn(key, answer).find((k) => !asked.includes(k)) ?? null;
}

// ---- A test of the fixed words ----

export const BREAK_KINDS = ['several questions', 'no question', 'praise', 'why', 'leading', 'hypothetical', 'doubt', 'dates', 'too long'] as const;
export type BreakKind = (typeof BREAK_KINDS)[number];
// detail names what was found, in words.
export type Break = { kind: BreakKind; detail: string };
export type Check = { ok: true } | { ok: false; breaks: Break[] };

// The most words in one interviewer turn.
export const MAX_WORDS = 60;

// Praise, agreement or a claimed feeling. The interviewer listens; it does not judge or feel.
export const PRAISE: readonly RegExp[] = [
  /\bgreat\b/, /\bwonderful\b/, /\bi love\b/, /\blove (?:that|this|it)\b/, /\bi agree\b/, /\bi enjoyed\b/, /\bimpressive\b/, /\bimpressed\b/, /\binteresting\b/,
  /\bamazing\b/, /\bfantastic\b/, /\bexcellent\b/, /\bawesome\b/, /\bbrilliant\b/, /\bfascinating\b/, /\bwell done\b/, /\bgood job\b/, /\bnice\b/,
  /\bperfect\b/, /\bcool\b/, /\bglad\b/, /\bsorry to hear\b/, /\bi feel\b/, /\bi'm (?:happy|excited|thrilled|delighted)\b/, /\bmakes sense\b/,
  /\babsolutely\b/, /\bthanks? (?:you )?for sharing\b/,
];
export const WHY: readonly RegExp[] = [/\bwhy\b/];
// Leading forms, and an either/or question: a yes-or-no question about one thing that offers two answers
// ("Was it X or Y?"). "Is there a number, a date or a user?" asks for any of a list, so it is not one.
export const LEADING: readonly RegExp[] = [
  /\bdon't you think\b/, /\bdo you not think\b/, /\bwouldn't you say\b/, /\bwould you not say\b/, /\bisn't (?:it|that)\b/, /\bwasn't (?:it|that)\b/,
  /\bdidn't you\b/, /\bweren't you\b/, /\baren't you\b/, /\bsurely\b/, /, right\?/, /, correct\?/,
];
const EITHER_OR = /^(?:was|were|is|are|did|do|does|had|has)\s+(?:it|that|this|those|these|you|they|he|she|we|the\s+\S+)\b[^?]*\bor\b/;
export const HYPOTHETICAL: readonly RegExp[] = [
  /\bwould you\b/, /\bwhat would\b/, /\bimagine (?:if|that|you)\b/, /\bwhat if\b/, /\bsuppos(?:e|ing)\b/, /\bif you (?:could|had|were)\b/, /\bwould have\b/, /\bhypothetically\b/,
];
// Doubt about what the owner said. Their account is taken as true.
export const DOUBT: readonly RegExp[] = [
  /\bare you sure\b/, /\bare you certain\b/, /\bis that (?:correct|right|accurate|true)\b/, /\bcan you confirm\b/, /\bjust to confirm\b/, /\bdid you really\b/,
  /\bare those dates right\b/, /\breally\?/, /\bdouble[- ]check\b/, /\bthat seems (?:high|low|unlikely|a lot)\b/,
];
// The dates of a job, and two jobs at once. The owner decided dates are never questioned. Asking for "a date" as
// evidence of a result, or offering one as a way to remember, is not this.
export const DATES: readonly RegExp[] = [
  /\bdates\b/, /\b(?:start|end|leaving|joining) date\b/, /\bwhen did you (?:start|join|leave|begin|finish|quit|move)\b/, /\b(?:what|which) (?:year|month)\b/,
  /\bhow long (?:were you|did you (?:work|stay|spend))\b/, /\boverlap(?:s|ped|ping)?\b/, /\bsame time as\b/, /\b(?:two|both) (?:jobs|roles|employers|positions)\b/,
  /\bgap (?:between|in)\b/,
];
// A second ask joined to the first inside one sentence ("... and also ...", "... and who ...").
export const SECOND_ASK: readonly RegExp[] = [/\band also\b/, /\band (?:what|who|whom|how|where|which|when|why)\b/, /\band another thing\b/, /\bsecond question\b/];
// A sentence that asks without a question mark ("Tell me about a time ...").
export const ASK_OPENERS: readonly RegExp[] = [/^tell (?:me|it)\b/, /^take me\b/, /^walk me\b/, /^talk me through\b/, /^describe\b/, /^give me\b/, /^pick\b/, /^say more\b/, /^go on\b/, /^think (?:of|back)\b/, /^start from\b/];

// Turns that need no question: the opening, the reminder and the closing.
export type TurnStep = 'opening' | 'reminder' | 'question' | 'follow-up' | 'closing';

const sentences = (s: string) => s.split(/(?<=[.?!])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const isQuestion = (sentence: string) => /\?["'”’)\]]*$/.test(sentence);
const found = (rs: readonly RegExp[], s: string) => rs.map((r) => s.match(r)?.[0]).filter((m): m is string => m !== undefined);

// A test of the fixed words, and nothing more: every fixed text must pass it (lib/capture.test.ts). It is NOT enough to
// check a turn a model writes, and nothing calls it at run time. On a reviewer's samples it passed 45 of 45 turns that
// break a rule ("Thank you.", "That sounds like a tough spot.", "Was it really 40 percent?", "When did you get
// promoted?", "What did you build, who used it?") and refused 15 of 21 ordinary asks ("Please describe the first
// week.", "How would you describe your part in it?"). A model behind the interviewer needs a new design, not this.
export function checkTurn(text: string, step: TurnStep): Check {
  const s = plain(text), parts = sentences(s), breaks: Break[] = [];
  const add = (kind: BreakKind, detail: string) => breaks.push({ kind, detail });
  const questions = parts.filter(isQuestion);
  const joined = found(SECOND_ASK, s);
  // A sentence that asks without a question mark counts only when the turn has no question mark: "What was the
  // hardest part? Tell me what happened." is one ask, "Tell me what you built. Describe who used it." is two.
  const asksWithout = parts.filter((p) => !isQuestion(p) && any(ASK_OPENERS, p)).length;
  const asks = (questions.length > 0 ? questions.length : asksWithout) + joined.length;
  if (asks > 1) add('several questions', `${questions.length} question marks${joined.length ? `, and a second ask joined by "${joined.join('", "')}"` : ''}`);
  if (asks === 0 && (step === 'question' || step === 'follow-up')) add('no question', 'the turn asks nothing');
  for (const m of found(PRAISE, s)) add('praise', m);
  for (const m of found(WHY, s)) add('why', m);
  for (const m of found(LEADING, s)) add('leading', m);
  for (const q of questions) if (EITHER_OR.test(q)) add('leading', `either/or: "${q}"`);
  for (const m of found(HYPOTHETICAL, s)) add('hypothetical', m);
  for (const m of found(DOUBT, s)) add('doubt', m);
  for (const m of found(DATES, s)) add('dates', m);
  const n = words(text).length;
  if (n > MAX_WORDS) add('too long', `${n} words, the most is ${MAX_WORDS}`);
  return breaks.length ? { ok: false, breaks } : { ok: true };
}

// ---- What to say next ----

export type Limits = {
  maxTurns: number; // a sitting never holds more turns than this, both sides and the closing line counted
  maxFollowUps: number; // follow-ups on one question
};
export const LIMITS: Limits = { maxTurns: 40, maxFollowUps: 2 };

export const END_REASONS = ['done', 'stopped', 'limit'] as const;
export type EndReason = (typeof END_REASONS)[number];

// A step the program plans. Every key here is in the list.
export type Step =
  | { step: 'opening' }
  | { step: 'reminder' }
  | { step: 'question'; key: QuestionKey }
  | { step: 'follow-up'; key: QuestionKey; kind: FollowUpKind }
  | { step: 'closing'; reason: EndReason };
// A turn as stored and read back. A stored turn may name a question or a follow-up kind that has since left the list
// (null here): such a turn still waits for its answer, but settles nothing and gets no follow-up.
export type InterviewerTurn = { who: 'interviewer'; text: string } & (
  | { step: 'opening' }
  | { step: 'reminder' }
  | { step: 'question'; key: QuestionKey | null }
  | { step: 'follow-up'; key: QuestionKey | null; kind: FollowUpKind | null }
  | { step: 'closing'; reason: EndReason });
// key and followUp are those of the interviewer turn this answers. closes: the answer was "I don't know" (isDontKnow),
// decided when it was given and kept, so the question stays closed for good.
export type OwnerTurn = { who: 'owner'; text: string; key: QuestionKey | null; followUp: FollowUpKind | null; closes: boolean };
export type Turn = InterviewerTurn | OwnerTurn;

// A sitting so far, as data. turns: this sitting's, oldest first. settled: the questions already answered or closed
// for the same role or project, in any sitting. picked: the owner's answer to "pick" in an earlier sitting, for the
// reminder. stop: the owner asked to stop (a button, never a typed word).
export type SittingState = { subject: SubjectKind; turns: readonly Turn[]; settled?: ReadonlySet<QuestionKey>; picked?: string; stop?: boolean; limits?: Partial<Limits> };
export type Plan = Step | { step: 'wait' } | { step: 'ended' };

const waiting = (t: Turn | undefined) => t?.who === 'interviewer' && (t.step === 'question' || t.step === 'follow-up');

// The owner's turn for an answer to the last interviewer turn, or null when no question is waiting.
export function answerTo(last: Turn | undefined, text: string): OwnerTurn | null {
  if (last?.who !== 'interviewer' || (last.step !== 'question' && last.step !== 'follow-up')) return null;
  return { who: 'owner', text, key: last.key, followUp: last.step === 'follow-up' ? last.kind : null, closes: isDontKnow(text) };
}

// The questions of the list answered or closed in these turns, with those settled before.
export function settledKeys(turns: readonly Turn[], before: ReadonlySet<QuestionKey> = new Set()): Set<QuestionKey> {
  const out = new Set(before);
  for (const t of turns) if (t.who === 'owner' && t.key !== null && hasWords(t.text)) out.add(t.key);
  return out;
}

// Whether an answer to "pick" names a piece of work that the reminder can quote: not a bare "No", not "I don't know",
// not "I don't remember", and not an answer with no words.
export const canQuote = (answer: string): boolean => hasWords(answer) && phrase(answer) !== '' && !isBareNo(answer) && !isDontKnow(answer) && !any(NOT_REMEMBER, plain(answer));

// Limits a caller may pass. Each is a whole number, and may only lower the default: a sitting never runs longer than
// LIMITS allows. The fewest turns is four, room for an opening, one question, one answer and a closing line.
export const MIN_TURNS = 4;
export function checkLimits(limits: Partial<Limits> = {}): Limits {
  const L = { ...LIMITS, ...limits };
  if (!Number.isInteger(L.maxTurns) || L.maxTurns < MIN_TURNS || L.maxTurns > LIMITS.maxTurns) throw new Error(`maxTurns must be a whole number from ${MIN_TURNS} to ${LIMITS.maxTurns}, not ${L.maxTurns}.`);
  if (!Number.isInteger(L.maxFollowUps) || L.maxFollowUps < 0 || L.maxFollowUps > LIMITS.maxFollowUps) throw new Error(`maxFollowUps must be a whole number from 0 to ${LIMITS.maxFollowUps}, not ${L.maxFollowUps}.`);
  return L;
}

// What the interviewer does next, decided by the program alone. In order: a closed sitting stays closed; the owner
// stopping closes it; an open question waits for its answer; the first turn is the opening. Otherwise the next ask is
// a follow-up on a gap in the last answer, or else the next question not yet settled; with no ask left, the list is
// done. In a later sitting the reminder of the piece of work comes right after the opening, before the first ask. An
// ask is made only if there is room for it (and the reminder), its answer and the closing line; if not, the turn limit
// closes the sitting.
export function planStep(state: SittingState): Plan {
  const L = checkLimits(state.limits);
  const turns = state.turns, last = turns.at(-1);
  if (last?.who === 'interviewer' && last.step === 'closing') return { step: 'ended' };
  if (state.stop) return { step: 'closing', reason: 'stopped' };
  if (last === undefined) return { step: 'opening' };
  if (waiting(last)) return { step: 'wait' };
  const ask = nextAsk(turns, state.settled, L.maxFollowUps);
  if (ask === null) return { step: 'closing', reason: 'done' };
  const remind = state.picked !== undefined && canQuote(state.picked) && turns.length === 1 && last.who === 'interviewer' && last.step === 'opening';
  if (turns.length + 3 + (remind ? 1 : 0) > L.maxTurns) return { step: 'closing', reason: 'limit' };
  return remind ? { step: 'reminder' } : ask;
}
function nextAsk(turns: readonly Turn[], before: ReadonlySet<QuestionKey> | undefined, maxFollowUps: number): Step | null {
  const last = turns.at(-1);
  if (last?.who === 'owner' && last.key !== null && !last.closes) {
    const key = last.key;
    const asked = turns.flatMap((t) => (t.who === 'interviewer' && t.step === 'follow-up' && t.key === key && t.kind !== null ? [t.kind] : []));
    const kind = followUpFor(key, last.text, asked, maxFollowUps);
    if (kind) return { step: 'follow-up', key, kind };
  }
  // A question already asked in this sitting is not asked again in it, even when its answer was deleted: that would
  // be out of order. It is open again for the next sitting.
  const settled = settledKeys(turns, before);
  for (const t of turns) if (t.who === 'interviewer' && t.step === 'question' && t.key !== null) settled.add(t.key);
  const next = QUESTIONS.find((q) => !settled.has(q.key));
  return next ? { step: 'question', key: next.key } : null;
}

// The fixed words for a step. picked is the owner's earlier answer to "pick", for the reminder.
export function fixedText(step: Step, subject: SubjectKind, picked = ''): string {
  switch (step.step) {
    case 'opening': return OPENING;
    case 'reminder': return reminderText(picked);
    case 'question': return questionText(step.key, subject);
    case 'follow-up': return FOLLOW_UPS[step.kind].text;
    case 'closing': return step.reason === 'done' ? CLOSING_DONE : CLOSING_PAUSED;
    default: return never(step);
  }
}
function never(x: never): never { throw new Error(`Not handled: ${JSON.stringify(x)}`); }

// say: the next interviewer turn, in fixed words. wait: the owner's answer is due. ended: the sitting is over.
export type Next = { do: 'say'; turn: InterviewerTurn & Step } | { do: 'wait' } | { do: 'ended' };

// What to say next. The words always come from the fixed data, so the fixed list alone drives a whole sitting.
export function nextTurn(state: SittingState): Next {
  const plan = planStep(state);
  if (plan.step === 'wait') return { do: 'wait' };
  if (plan.step === 'ended') return { do: 'ended' };
  return { do: 'say', turn: { who: 'interviewer', text: fixedText(plan, state.subject, state.picked), ...plan } };
}
