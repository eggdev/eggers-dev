// `bun tools/discover.ts`: checks the watchlist now and scores what it finds, as the worker does
// once a day. Run it while the worker is idle.
import { db } from '../lib/db.ts';
import { discover } from '../lib/discover.ts';

db.run("UPDATE discovery SET status = 'running', note = '' WHERE id = 1");
try {
  const said = await discover(Date.now());
  db.query("UPDATE discovery SET status = 'idle', note = ?, checked_at = ? WHERE id = 1").run(said, Date.now());
  console.log(said);
} catch (e) {
  db.query("UPDATE discovery SET status = 'failed', note = ?, checked_at = ? WHERE id = 1").run((e as Error).message, Date.now());
  console.log(`failed: ${(e as Error).message}`);
}
