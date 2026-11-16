// The daily limits on questions that reach the model, counted per UTC day, so neither a flood of visitors nor one
// busy visitor can spend the model budget without bound:
//   - the day's total for all visitors together (the var MAX_QUESTIONS_PER_DAY);
//   - each visitor's share of it (the var MAX_QUESTIONS_PER_VISITOR_PER_DAY). A visitor is a visitor key
//     (visitor.ts), so one visitor at their share cannot use up the day for everyone else.
// The per-minute limit per visitor (ASK_LIMIT) is a separate check.
//
// The counts live in one Durable Object with SQLite storage, named BUDGET_NAME (index.ts holds the class,
// QuestionBudget; wrangler.jsonc binds it as BUDGET). One call checks and counts both limits together, and one
// object sees every question in order, so two questions cannot both take the last place.
// No address is stored: a visitor's row is named by the SHA-256 of the UTC day and the visitor key. The first
// question of a new day deletes the rows of earlier days, so the tables stay small.
// This file has no Cloudflare imports, so `bun test` can run the counter on an in-memory SQLite database.

/** The part of a Durable Object's SQL storage (ctx.storage.sql) the counter uses. */
export interface Sql {
  exec(query: string, ...bindings: (string | number)[]): { toArray(): Record<string, unknown>[] };
}

/** One question to count: who asks, and the two limits for today. */
export type Ask = { visitor: string; perVisitor: number; perDay: number };

/** "counted", or which limit is full: the visitor's share or the day's total. Nothing is counted when full. */
export type Taken = 'counted' | 'visitor' | 'day';

/** The Durable Object's stub, as the Worker sees it. */
export interface BudgetStub {
  take(ask: Ask): Promise<Taken>;
}

/** The Durable Object namespace binding (BUDGET). */
export interface BudgetNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): BudgetStub;
}

export const BUDGET_NAME = 'budget';

/** The UTC day of a time, such as "2026-11-16". */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The stored name of a visitor's row: the SHA-256, in hex, of the day and the visitor key. */
export async function visitorId(day: string, visitor: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}\n${visitor}`));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The counter inside the Durable Object. Every value reaches SQL as a bound parameter, never as SQL text. */
export class QuestionCounter {
  constructor(private readonly sql: Sql) {
    sql.exec('CREATE TABLE IF NOT EXISTS questions (day TEXT PRIMARY KEY, asked INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, day TEXT NOT NULL, asked INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS visitors_day ON visitors (day)');
  }

  private count(query: string, key: string): number {
    const row = this.sql.exec(query, key).toArray()[0];
    return Number(row?.asked ?? 0);
  }

  /** Counts one question for the day of `now` against both limits, or says which limit is full. */
  async take(ask: Ask, now: number): Promise<Taken> {
    const day = utcDay(now);
    const id = await visitorId(day, ask.visitor);
    // From here to the end nothing awaits, so no other question can run between the check and the count.
    const today = this.count('SELECT asked FROM questions WHERE day = ?', day);
    if (today === 0) {
      // The first question of a new day: the earlier days are done.
      this.sql.exec('DELETE FROM questions WHERE day < ?', day);
      this.sql.exec('DELETE FROM visitors WHERE day < ?', day);
    }
    if (today >= ask.perDay) return 'day';
    if (this.count('SELECT asked FROM visitors WHERE id = ?', id) >= ask.perVisitor) return 'visitor';
    this.sql.exec('INSERT INTO questions (day, asked) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET asked = asked + 1', day);
    this.sql.exec('INSERT INTO visitors (id, day, asked) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET asked = asked + 1', id, day);
    return 'counted';
  }

  /** The day's total for the day of `now`. */
  asked(now: number): number {
    return this.count('SELECT asked FROM questions WHERE day = ?', utcDay(now));
  }

  /** One visitor's count for the day of `now`. */
  async visitorAsked(visitor: string, now: number): Promise<number> {
    return this.count('SELECT asked FROM visitors WHERE id = ?', await visitorId(utcDay(now), visitor));
  }
}

/** What the Worker calls: counts one question in the one Durable Object. It throws when the object fails. */
export function countQuestion(budget: BudgetNamespace | undefined, ask: Ask): Promise<Taken> {
  if (budget === undefined) throw new Error('the BUDGET binding is missing');
  return budget.get(budget.idFromName(BUDGET_NAME)).take(ask);
}
