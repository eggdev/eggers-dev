// The Cloudflare Worker for the public site: POST /ask answers from the published collection; every other path is
// the built site in dist/ (wrangler.jsonc "assets"), its 404 page included.
//
// This file holds the parts that need the Workers runtime; the logic is in files `bun test` runs with fakes:
//   the Worker      ask.ts, made once per isolate so the collection's 60-second cache lives between requests.
//                   The collection is read at request time from the R2 bucket CONTENT (collection.ts).
//   QuestionBudget  the Durable Object (SQLite storage) that counts the questions of each UTC day, in total and per
//                   visitor (budget.ts).
import { DurableObject } from 'cloudflare:workers';
import { worker } from './ask.ts';
import { QuestionCounter, type Ask, type Sql, type Taken } from './budget.ts';

export default worker();

/** The one Durable Object, named "budget": the daily limits on questions. */
export class QuestionBudget extends DurableObject {
  private readonly counter: QuestionCounter;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.counter = new QuestionCounter(ctx.storage.sql as unknown as Sql);
  }

  /** Counts one question for today (UTC) against the visitor's share and the day's total, or says which is full. */
  async take(ask: Ask): Promise<Taken> {
    return this.counter.take(ask, Date.now());
  }
}
