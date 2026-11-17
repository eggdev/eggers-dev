// Questions that code raises for the person, as opposed to the ones a model writes into a job's reading
// (lib/talk.ts lists both). A finding in the data that only the person can settle becomes one row here:
// two jobs that both say Present, a title that differs from LinkedIn, a new skill not yet marked.
// - `key` is stable for a finding, so the same finding is never asked twice, however often it is found.
// - `live` is 1 while the finding still holds. One that the data no longer shows is not asked.
// - An answered question stays answered: finding it again changes nothing.
// - A question is closed only by `answer` (POST /questions), which also does what the answer asks. Talk does
//   not list these questions and cannot close one: closing one without applying its answer would be a guess.
// A kind may register what an answer does (set a role's label, mark a skill): see `onAnswer`.
import { db } from './db.ts';

db.run(`CREATE TABLE IF NOT EXISTS raised_questions (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, choices TEXT NOT NULL DEFAULT '[]', about TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}', live INTEGER NOT NULL DEFAULT 1, raised_at INTEGER NOT NULL, answered_at INTEGER NOT NULL DEFAULT 0, answer TEXT NOT NULL DEFAULT '')`);

type Row = { key: string; kind: string; text: string; choices: string; about: string; data: string; live: number; raised_at: number; answered_at: number; answer: string };
// about says what the question concerns: "role:3,role:5", "skill:rust". data is whatever its kind needs to act on an answer.
export type Raised = { key: string; kind: string; text: string; choices: string[]; about: string; data: Record<string, unknown>; live: boolean; raisedAt: number; answeredAt: number; answer: string };
export type Finding = { key: string; text: string; choices?: string[]; about?: string; data?: Record<string, unknown> };

const shape = (r: Row): Raised => ({ key: r.key, kind: r.kind, text: r.text, choices: JSON.parse(r.choices || '[]'), about: r.about, data: JSON.parse(r.data || '{}'), live: r.live === 1, raisedAt: r.raised_at, answeredAt: r.answered_at, answer: r.answer });

// Brings one kind's questions in step with what was just found. New findings are added. An open question
// takes the finding's current wording. Questions whose finding is gone stop being live. Answered ones are left alone.
export function raise(kind: string, found: Finding[], now: number): void {
  db.transaction(() => {
    const keys = new Set(found.map((f) => f.key));
    for (const r of db.query('SELECT key FROM raised_questions WHERE kind = ?').all(kind) as { key: string }[]) {
      db.query('UPDATE raised_questions SET live = ? WHERE key = ?').run(keys.has(r.key) ? 1 : 0, r.key);
    }
    for (const f of found) {
      const args = [f.text, JSON.stringify(f.choices ?? []), f.about ?? '', JSON.stringify(f.data ?? {})];
      db.query('INSERT OR IGNORE INTO raised_questions (key, kind, text, choices, about, data, raised_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.key, kind, ...args, now);
      db.query('UPDATE raised_questions SET text = ?, choices = ?, about = ?, data = ? WHERE key = ? AND answered_at = 0').run(...args, f.key);
    }
  })();
}

// The questions still waiting for the person, oldest first.
export const openRaised = (): Raised[] => (db.query('SELECT * FROM raised_questions WHERE live = 1 AND answered_at = 0 ORDER BY raised_at, key').all() as Row[]).map(shape);
export const raisedByKey = (key: string): Raised | undefined => { const r = db.query('SELECT * FROM raised_questions WHERE key = ?').get(key) as Row | null; return r ? shape(r) : undefined; };
// What the person answered, for the kinds a resume's writer must follow (a decision on how to show short jobs).
// `liveOnly` false also gives those whose finding is gone (an answer that itself made the finding go away).
export const answeredRaised = (kind: string, liveOnly = true): Raised[] => (db.query(`SELECT * FROM raised_questions WHERE kind = ? AND answered_at > 0 ${liveOnly ? 'AND live = 1' : ''} ORDER BY answered_at`).all(kind) as Row[]).map(shape);

// The longest text that may come with an answer (a context note).
export const MAX_VALUE = 200;

// An answer can change a role, and so the bank's signature, which makes the worker write every unsent resume
// again (6 to 22 model calls each). The person often answers several questions in one sitting, minutes apart.
// So the worker waits this long after the last answer before it writes for a changed bank: one sitting, one rewrite.
export const ANSWER_HOLD_MS = 15 * 60_000;
export const lastAnswerAt = (): number => (db.query('SELECT max(answered_at) AS at FROM raised_questions').get() as { at: number | null }).at ?? 0;
// Hand edits in Experience (lib/record.ts) can change the bank's signature too, and one sitting of them lasts longer
// than the worker's quiet time. When the owner last wrote to the record by hand (0 for never).
export const lastHandWriteAt = (): number => (db.query('SELECT at FROM record_written WHERE id = 1').get() as { at: number } | null)?.at ?? 0;
// What the rewrite of unsent resumes is held after: the later of the last answer and the last hand write.
export const holdSince = (): number => Math.max(lastAnswerAt(), lastHandWriteAt());
// Whether the worker may now queue resumes for a changed bank: the bank has been still for `quietMs`, and the
// last answer (0 when there is none) is at least `holdMs` old. Pure, so it is tested with a made-up clock.
export const rewriteDue = (now: number, stillSince: number, quietMs: number, lastAnswer: number, holdMs = ANSWER_HOLD_MS): boolean =>
  now - stillSince >= quietMs && (lastAnswer === 0 || now - lastAnswer >= holdMs);

// What an answer does, by kind. It returns '' when done, or a plain sentence saying why it could not be done.
type Applier = (q: Raised, choice: number, value: string, now: number) => string;
const appliers = new Map<string, Applier>();
export const onAnswer = (kind: string, apply: Applier) => { appliers.set(kind, apply); };

// Records the person's answer and does what it asks. Returns '' when done, else why not (nothing is then recorded).
export function answer(key: string, choice: number, value: string, now: number): string {
  const q = raisedByKey(key);
  if (!q || !q.live) return 'That question is no longer open.';
  // An answer is applied once. A second one would run its action again.
  if (q.answeredAt > 0) return 'That question is already answered.';
  if (value.length > MAX_VALUE || /[\r\n]/.test(value)) return `Keep what you write to one line of at most ${MAX_VALUE} characters.`;
  if (q.choices.length > 0 && !(Number.isInteger(choice) && choice >= 0 && choice < q.choices.length)) return 'Choose one of the listed answers.';
  const refused = appliers.get(q.kind)?.(q, choice, value, now) ?? '';
  if (refused) return refused;
  db.query('UPDATE raised_questions SET answered_at = ?, answer = ? WHERE key = ?').run(now, [q.choices[choice] ?? '', value].filter(Boolean).join(': '), key);
  return '';
}
