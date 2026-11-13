// `bun tools/score.ts [days] [unscored]`: quick-scores every open found posting from the last `days`
// (default 7) against the profile and the current direction notes, then prints them best first.
// It scores again those that had a score, unless `unscored` is given. Four batches of 25 at a time; each batch is saved as it returns.
import { db } from '../lib/db.ts';
import { triage, type CompanyRow, type LeadRow } from '../lib/discover.ts';

const days = Number(process.argv[2] ?? 7);
const since = Date.now() - days * 86_400_000;
const names = new Map((db.query('SELECT * FROM companies').all() as CompanyRow[]).map((c) => [c.id, c.name]));
const leads = db.query(`SELECT * FROM leads WHERE status = 'new' AND posted_at > ?${process.argv[3] === 'unscored' ? ' AND score < 0' : ''} ORDER BY posted_at DESC`).all(since) as LeadRow[];
console.log(`${leads.length} open postings from the last ${days} days`);

const batches: LeadRow[][] = [];
for (let i = 0; i < leads.length; i += 25) batches.push(leads.slice(i, i + 25));
let done = 0;
const run = async (): Promise<void> => {
  const batch = batches.shift();
  if (!batch) return;
  try {
    for (const s of await triage(batch, names)) { db.query('UPDATE leads SET score = ?, reason = ? WHERE id = ?').run(s.score, s.reason, s.id); done++; }
    console.log(`  ${done} scored`);
  } catch (e) { console.log(`  a batch could not be scored: ${(e as Error).message}`); }
  return run();
};
await Promise.all([run(), run(), run(), run()]);

const rows = db.query("SELECT * FROM leads WHERE status = 'new' AND posted_at > ? AND score >= 0 ORDER BY score DESC").all(since) as LeadRow[];
for (const l of rows) console.log(`${String(l.score).padStart(3)}  ${names.get(l.company_id)}: ${l.title} (${l.place || 'no place given'})${l.salary ? ` ${l.salary}` : ''}\n     ${l.reason}`);
