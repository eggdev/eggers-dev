// The sittings of Capture (lib/capture.ts): each is one interview about one role or one project, and its turns. The
// owner's words are stored exactly as given: no trimming, no case change, no spelling fix, so a fact can later point
// at them and quote them. Nothing calls this yet, and it makes no facts. Additive only: new tables and their triggers,
// created when this file is imported.
//
// There are two ways to write a turn, and only two. advance: the module plans the next interviewer turn, takes its
// words from the fixed data and stores it under the planned question; no caller can store an interviewer turn out of
// order, under another key or in other words. recordAnswer: the owner's answer to the question now waiting, the only
// free text.
import { db, type RoleRow } from './db.ts';
import { levelOf, projectRef } from './tree.ts';
import {
  canQuote, checkLimits, END_REASONS, hasWords, isDontKnow, isFollowUpKind, isQuestionKey, nextTurn, QUESTIONS,
  type EndReason, type InterviewerTurn, type Limits, type OwnerTurn, type QuestionKey, type SittingState, type SubjectKind, type Turn,
} from './capture.ts';

// A sitting is about exactly one role or one project. state: open | ended. ended_by: why it ended (done: the list is
// finished, stopped: the owner stopped, limit: the turn limit), empty while open. Ids are never reused (AUTOINCREMENT),
// so a fact linked to a turn can never come to point at someone else's words.
db.run(`CREATE TABLE IF NOT EXISTS capture_sittings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER, project_id INTEGER,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'ended')),
  ended_by TEXT NOT NULL DEFAULT '' CHECK (ended_by IN ('', 'done', 'stopped', 'limit')),
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL DEFAULT 0,
  CHECK ((role_id IS NULL) != (project_id IS NULL)))`);
db.run('CREATE INDEX IF NOT EXISTS capture_sittings_role ON capture_sittings (role_id)');
db.run('CREATE INDEX IF NOT EXISTS capture_sittings_project ON capture_sittings (project_id)');
// who: interviewer | owner. step: opening | reminder | question | follow-up | closing for the interviewer, answer for
// the owner. question and follow_up: the question key and follow-up kind the turn belongs to ('' for none); a key that
// later leaves the list is kept as it was. closes: the owner said "I don't know", decided when it was said. The
// interviewer's words are always the fixed ones (lib/capture.ts), so no column says where they came from.
db.run(`CREATE TABLE IF NOT EXISTS capture_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sitting_id INTEGER NOT NULL,
  who TEXT NOT NULL CHECK (who IN ('interviewer', 'owner')),
  step TEXT NOT NULL CHECK (step IN ('opening', 'reminder', 'question', 'follow-up', 'closing', 'answer')),
  text TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', follow_up TEXT NOT NULL DEFAULT '',
  closes INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)`);
db.run('CREATE INDEX IF NOT EXISTS capture_turns_sitting ON capture_turns (sitting_id)');
// A deletion the owner asks for is real: a deleted role or project takes its sittings and every word in them. Each
// trigger deletes the turns itself rather than counting on another trigger. A project that is a roles row (via_role)
// deletes that row too (lib/record.ts), so both triggers run. Created only if missing, so a change to a body needs a
// DROP first to reach an existing database.
db.run(`CREATE TRIGGER IF NOT EXISTS capture_role_gone AFTER DELETE ON roles BEGIN
  DELETE FROM capture_turns WHERE sitting_id IN (SELECT id FROM capture_sittings WHERE role_id = OLD.id);
  DELETE FROM capture_sittings WHERE role_id = OLD.id; END`);
db.run(`CREATE TRIGGER IF NOT EXISTS capture_project_gone AFTER DELETE ON projects BEGIN
  DELETE FROM capture_turns WHERE sitting_id IN (SELECT id FROM capture_sittings WHERE project_id = OLD.id);
  DELETE FROM capture_sittings WHERE project_id = OLD.id; END`);

export type Subject = { kind: SubjectKind; id: number };
export type Sitting = { id: number; subject: Subject; state: 'open' | 'ended'; endedBy: EndReason | null; startedAt: number; endedAt: number };
// A stored turn. question is the key as stored, which may no longer be in the list (the turn's key is then null).
export type StoredTurn = Turn & { id: number; at: number; question: string };
export type Refused = { ok: false; error: string };

type SittingRow = { id: number; role_id: number | null; project_id: number | null; state: string; ended_by: string; started_at: number; ended_at: number };
type TurnRow = { id: number; sitting_id: number; who: string; step: string; text: string; question: string; follow_up: string; closes: number; at: number };

const isEndReason = (s: string): s is EndReason => (END_REASONS as readonly string[]).includes(s);

function toSitting(r: SittingRow): Sitting {
  const subject: Subject = r.role_id !== null ? { kind: 'role', id: r.role_id } : { kind: 'project', id: r.project_id! };
  return { id: r.id, subject, state: r.state === 'ended' ? 'ended' : 'open', endedBy: isEndReason(r.ended_by) ? r.ended_by : null, startedAt: r.started_at, endedAt: r.ended_at };
}

// A stored row as the turn capture.ts reasons about. A question key or follow-up kind no longer in the list reads as
// null: the turn stays in place and settles nothing.
function toTurn(r: TurnRow, endedBy: EndReason | null): StoredTurn {
  const key = isQuestionKey(r.question) ? r.question : null;
  const kind = isFollowUpKind(r.follow_up) ? r.follow_up : null;
  const base = { id: r.id, at: r.at, text: r.text, question: r.question };
  if (r.who === 'owner') {
    const owner: OwnerTurn = { who: 'owner', text: r.text, key, followUp: kind, closes: r.closes === 1 };
    return { ...owner, ...base };
  }
  const head = { ...base, who: 'interviewer' as const };
  switch (r.step) {
    case 'opening': return { ...head, step: 'opening' };
    case 'reminder': return { ...head, step: 'reminder' };
    case 'closing': return { ...head, step: 'closing', reason: endedBy ?? 'stopped' };
    case 'question': return { ...head, step: 'question', key };
    // The table's CHECK allows no other step.
    default: return { ...head, step: 'follow-up', key, kind };
  }
}

const subjectWhere = (s: Subject) => (s.kind === 'role' ? 'role_id = ?' : 'project_id = ?');

// Why a sitting cannot be about this role or project, or '' when it can. A roles row that the record shows as a
// project, a side project or a repository nobody placed (lib/tree.ts, levelOf) is not a role: a sitting about it is
// started on the project that carries it, so the same work never has two separate question lists.
function subjectProblem(s: Subject): string {
  if (s.kind === 'project') return db.query('SELECT 1 FROM projects WHERE id = ?').get(s.id) === null ? 'That project is not in the record.' : '';
  const roles = db.query('SELECT * FROM roles').all() as RoleRow[];
  const row = roles.find((r) => r.id === s.id);
  if (!row) return 'That role is not in the record.';
  const level = levelOf(row, roles);
  if (level === 'role') return '';
  const carrier = db.query('SELECT id FROM projects WHERE via_role = ?').get(s.id) as { id: number } | null;
  const what = level === 'project' ? 'a project' : level === 'side' ? 'a side project' : 'a repository not yet placed';
  return `That row is ${what} in the record, not a role. ${carrier ? `Start the sitting on its project, ${projectRef(carrier.id)}.` : 'Place it first.'}`;
}

export function sitting(id: number): Sitting | null {
  const r = db.query('SELECT * FROM capture_sittings WHERE id = ?').get(id) as SittingRow | null;
  return r ? toSitting(r) : null;
}
// The sittings about one role or project, oldest first.
export const sittingsOf = (s: Subject): Sitting[] => (db.query(`SELECT * FROM capture_sittings WHERE ${subjectWhere(s)} ORDER BY id`).all(s.id) as SittingRow[]).map(toSitting);

// A sitting's turns, oldest first.
export function turnsOf(sittingId: number): StoredTurn[] {
  const s = sitting(sittingId);
  if (!s) return [];
  return (db.query('SELECT * FROM capture_turns WHERE sitting_id = ? ORDER BY id').all(sittingId) as TurnRow[]).map((r) => toTurn(r, s.endedBy));
}

// What a later slice needs to link a fact to the owner's words: the turn's id and its exact text. Null when the turn
// is gone or is not the owner's.
export function ownerWords(turnId: number): { id: number; text: string } | null {
  const r = db.query("SELECT id, text FROM capture_turns WHERE id = ? AND who = 'owner'").get(turnId) as { id: number; text: string } | null;
  return r ? { id: r.id, text: r.text } : null;
}

export type QuestionState = 'open' | 'answered' | 'closed';
// Where each question of the list stands for one role or project, across all its sittings, in the list's order.
// answered: the owner gave an answer that was not "I don't know". closed: the only answers were "I don't know", so it
// is never asked again. open: not yet answered. A deleted answer no longer counts, so its question can open again. An
// answer filed under a key no longer in the list counts for nothing.
export function questionStatus(s: Subject): { key: QuestionKey; state: QuestionState }[] {
  const rows = db.query(`SELECT t.question, max(CASE WHEN t.closes = 0 THEN 1 ELSE 0 END) AS answered FROM capture_turns t
    JOIN capture_sittings x ON x.id = t.sitting_id WHERE x.${subjectWhere(s)} AND t.who = 'owner' GROUP BY t.question`).all(s.id) as { question: string; answered: number }[];
  const by = new Map(rows.map((r) => [r.question, r.answered === 1 ? 'answered' as const : 'closed' as const]));
  return QUESTIONS.map((q) => ({ key: q.key, state: by.get(q.key) ?? 'open' }));
}
const settledFor = (s: Subject) => new Set(questionStatus(s).filter((q) => q.state !== 'open').map((q) => q.key));
// For the reminder: the owner's latest answer about "pick" that names a piece of work (canQuote), follow-up answers
// included. After "I can't remember one", the real pick is in the answer to the anchor follow-up. None: no reminder.
const pickedFor = (s: Subject) => (db.query(`SELECT t.text FROM capture_turns t JOIN capture_sittings x ON x.id = t.sitting_id
  WHERE x.${subjectWhere(s)} AND t.who = 'owner' AND t.question = 'pick' ORDER BY t.id DESC`).all(s.id) as { text: string }[]).find((r) => canQuote(r.text))?.text;

// Starts a sitting about a role or a project. If one is already open for it, that one is given back (resumed: true),
// so there is never more than one open sitting about the same thing. A new sitting continues with the questions not
// yet answered or closed; when none is left there is nothing to start.
export function startSitting(s: Subject, now: number): { ok: true; id: number; resumed: boolean } | Refused {
  const problem = subjectProblem(s);
  if (problem) return { ok: false, error: problem };
  return db.transaction((): { ok: true; id: number; resumed: boolean } | Refused => {
    const open = db.query(`SELECT id FROM capture_sittings WHERE ${subjectWhere(s)} AND state = 'open' ORDER BY id LIMIT 1`).get(s.id) as { id: number } | null;
    if (open) return { ok: true, id: open.id, resumed: true };
    if (questionStatus(s).every((q) => q.state !== 'open')) return { ok: false, error: 'Every question about this is already answered.' };
    const r = db.query('INSERT INTO capture_sittings (role_id, project_id, started_at) VALUES (?, ?, ?) RETURNING id')
      .get(s.kind === 'role' ? s.id : null, s.kind === 'project' ? s.id : null, now) as { id: number };
    return { ok: true, id: r.id, resumed: false };
  }).immediate();
}

// A sitting as capture.ts takes it, to decide what to say next. Read only.
export function stateOf(sittingId: number, opts: { stop?: boolean; limits?: Partial<Limits> } = {}): SittingState | null {
  const s = sitting(sittingId);
  if (!s) return null;
  return { subject: s.subject.kind, turns: turnsOf(sittingId), settled: settledFor(s.subject), picked: pickedFor(s.subject), stop: opts.stop, limits: opts.limits };
}

// An interviewer turn as advance stored it.
export type SaidTurn = InterviewerTurn & { id: number; at: number; question: string };
export type Advanced = { ok: true; said: SaidTurn[]; now: 'waiting' | 'ended' };

// Moves a sitting on: the module plans each next interviewer turn, takes its fixed words and stores it, until a
// question waits for the owner's answer or the sitting ends. said is what to show, in order (an opening, a reminder
// and a question can come together). stop: the owner asked to stop; the closing line is said and the sitting ends.
// A closing line always ends the sitting, for the reason the plan gives: the program decides the end. limits may only
// lower the defaults and must be whole numbers (checkLimits in lib/capture.ts); bad ones throw before anything is read.
export function advance(sittingId: number, now: number, opts: { stop?: boolean; limits?: Partial<Limits> } = {}): Advanced | Refused {
  checkLimits(opts.limits);
  return db.transaction((): Advanced | Refused => {
    const s = sitting(sittingId);
    if (!s) return { ok: false, error: 'That sitting is not in the record.' };
    if (s.state === 'ended') return { ok: true, said: [], now: 'ended' };
    const said: SaidTurn[] = [];
    // Every pass stores one turn, and a sitting holds at most a few statements in a row, so this always ends.
    for (let pass = 0; pass < 10; pass++) {
      const state = stateOf(sittingId, opts)!;
      const next = nextTurn(state);
      if (next.do === 'wait') return { ok: true, said, now: 'waiting' };
      if (next.do === 'ended') return { ok: true, said, now: 'ended' };
      said.push(store(sittingId, next.turn, now));
      if (next.turn.step === 'closing') { endSitting(sittingId, next.turn.reason, now); return { ok: true, said, now: 'ended' }; }
    }
    throw new Error(`Sitting ${sittingId} did not reach a question or an end.`);
  }).immediate();
}
function store(sittingId: number, turn: InterviewerTurn, now: number): SaidTurn {
  const question = turn.step === 'question' || turn.step === 'follow-up' ? turn.key ?? '' : '';
  const followUp = turn.step === 'follow-up' ? turn.kind ?? '' : '';
  const r = db.query("INSERT INTO capture_turns (sitting_id, who, step, text, question, follow_up, at) VALUES (?, 'interviewer', ?, ?, ?, ?, ?) RETURNING id")
    .get(sittingId, turn.step, turn.text, question, followUp, now) as { id: number };
  return { ...turn, id: r.id, at: now, question };
}

// Thrown inside the transaction to undo a write whose text did not read back the same.
class NotExact extends Error {}

// Stores the owner's answer to the question or follow-up now waiting, exactly as given, under that question's key as
// stored. Refused when nothing is waiting, when the sitting has ended, when the answer holds no characters but spaces,
// or when the text would not read back exactly as given (a broken character, for one): then nothing is stored.
export function recordAnswer(sittingId: number, text: string, now: number): { ok: true; id: number; closes: boolean } | Refused {
  try {
    return db.transaction((): { ok: true; id: number; closes: boolean } | Refused => {
      const s = sitting(sittingId);
      if (!s) return { ok: false, error: 'That sitting is not in the record.' };
      if (s.state !== 'open') return { ok: false, error: 'That sitting has ended.' };
      if (text.trim() === '') return { ok: false, error: 'The answer is empty.' };
      // "?" or "🤷" alone is not stored: it is neither an answer nor a clear "I don't know".
      if (!hasWords(text)) return { ok: false, error: 'The answer has no words in it. If you do not know, say "I don\'t know".' };
      const last = db.query('SELECT * FROM capture_turns WHERE sitting_id = ? ORDER BY id DESC LIMIT 1').get(sittingId) as TurnRow | null;
      if (!last || last.who !== 'interviewer' || (last.step !== 'question' && last.step !== 'follow-up')) return { ok: false, error: 'No question is waiting for an answer.' };
      const closes = isDontKnow(text);
      const r = db.query("INSERT INTO capture_turns (sitting_id, who, step, text, question, follow_up, closes, at) VALUES (?, 'owner', 'answer', ?, ?, ?, ?, ?) RETURNING id")
        .get(sittingId, text, last.question, last.follow_up, closes ? 1 : 0, now) as { id: number };
      const back = (db.query('SELECT text FROM capture_turns WHERE id = ?').get(r.id) as { text: string }).text;
      if (back !== text) throw new NotExact();
      return { ok: true, id: r.id, closes };
    }).immediate();
  } catch (e) {
    if (e instanceof NotExact) return { ok: false, error: 'The answer could not be stored exactly as you gave it, so nothing was stored. It may hold an invisible or broken character; type it again.' };
    throw e;
  }
}

// The words for an answer to a question that is no longer waiting: answered already (a second send, a second tab), or
// in a sitting that has moved on. The caller shows the sitting as it stands now.
export const STALE = 'That question was already answered. Here is where the sitting stands.';
export type Answered = { ok: true; id: number; closes: boolean; said: SaidTurn[]; now: 'waiting' | 'ended' };

// Answers the interviewer turn turnId and moves the sitting on, in ONE transaction: the check that turnId is still the
// question waiting, the store of the answer exactly as given (recordAnswer) and the interviewer's next turns (advance).
// So two sends for one question store one answer (the other is refused with STALE and stale: true), and an answer is
// never stored without the sitting moving on: if advance fails, the answer is undone too. The other refusals are
// recordAnswer's, in its words.
export function answerTurn(sittingId: number, turnId: number, text: string, now: number, opts: { limits?: Partial<Limits> } = {}): Answered | (Refused & { stale?: true }) {
  checkLimits(opts.limits);
  return db.transaction((): Answered | (Refused & { stale?: true }) => {
    const s = sitting(sittingId);
    if (!s) return { ok: false, error: 'That sitting is not in the record.' };
    if (s.state !== 'open') return { ok: false, error: 'That sitting has ended.', stale: true };
    const last = db.query('SELECT * FROM capture_turns WHERE sitting_id = ? ORDER BY id DESC LIMIT 1').get(sittingId) as TurnRow | null;
    if (!last || last.id !== turnId || last.who !== 'interviewer' || (last.step !== 'question' && last.step !== 'follow-up')) return { ok: false, error: STALE, stale: true };
    const r = recordAnswer(sittingId, text, now);
    if (!r.ok) return r;
    const next = advance(sittingId, now, opts);
    // advance refuses only a sitting that is gone, which cannot happen inside this transaction; undo the answer if so.
    if (!next.ok) throw new Error(next.error);
    return { ok: true, id: r.id, closes: r.closes, said: next.said, now: next.now };
  }).immediate();
}

// Ends a sitting with no closing line, for a caller that must close one without saying anything. The normal end is
// advance with stop, which says the closing line. Returns false when the sitting is gone or already ended.
export const endSitting = (sittingId: number, reason: EndReason, now: number): boolean =>
  db.query("UPDATE capture_sittings SET state = 'ended', ended_by = ?, ended_at = ? WHERE id = ? AND state = 'open'").run(reason, now, sittingId).changes > 0;

// Deletes one sitting and every turn in it. Its answers no longer count, so their questions open again.
export function deleteSitting(sittingId: number): boolean {
  return db.transaction(() => {
    db.query('DELETE FROM capture_turns WHERE sitting_id = ?').run(sittingId);
    return db.query('DELETE FROM capture_sittings WHERE id = ?').run(sittingId).changes > 0;
  }).immediate();
}

// Deletes one of the owner's answers. An answer to the question itself takes with it every answer to a follow-up of the
// same question in the same sitting: the owner's whole reply to that question, so no follow-up answer stands without
// the answer it followed. An answer to a follow-up goes alone. The question then counts as unanswered unless another
// sitting answered it. The interviewer's turns stay. If that question is the last turn of an open sitting, it waits for
// a new answer. Otherwise it is not asked again in the same sitting, since that would be out of order: it comes in its
// place in the next sitting. Refused (false) for an interviewer turn or a turn that is gone.
export function deleteOwnerTurn(turnId: number): boolean {
  return db.transaction(() => {
    const t = db.query("SELECT * FROM capture_turns WHERE id = ? AND who = 'owner'").get(turnId) as TurnRow | null;
    if (!t) return false;
    if (t.follow_up === '' && t.question !== '') {
      db.query("DELETE FROM capture_turns WHERE sitting_id = ? AND who = 'owner' AND question = ? AND follow_up != ''").run(t.sitting_id, t.question);
    }
    return db.query('DELETE FROM capture_turns WHERE id = ?').run(turnId).changes > 0;
  }).immediate();
}
