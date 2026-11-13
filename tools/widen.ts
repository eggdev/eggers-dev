// `bun tools/widen.ts <file> [min]`: widens the watchlist from a file of candidate board names
// (whitespace-separated, as they appear in a careers link; `name=Display Name` sets how it is shown).
// Each is tried on Greenhouse, Ashby and Lever; one with at least `min` (default 2) suitable
// openings is added. Then every board is read, without scoring: `bun tools/score.ts 7 unscored`
// scores this week's.
import { readFileSync } from 'node:fs';
import { db } from '../lib/db.ts';
import { discover, fetchBoard, suits, type Ats } from '../lib/discover.ts';

const min = Number(process.argv[3] ?? 2);
const have = new Set((db.query('SELECT token FROM companies').all() as { token: string }[]).map((c) => c.token));
const wanted = new Map<string, string>();
for (const w of readFileSync(process.argv[2], 'utf8').split(/\s+/).filter(Boolean)) {
  const [token, ...shown] = w.split('=');
  if (!have.has(token)) wanted.set(token, shown.join('=').replaceAll('_', ' ') || token[0].toUpperCase() + token.slice(1));
}
const todo = [...wanted.keys()], added: string[] = [];
for (let i = 0; i < todo.length; i += 20) await Promise.all(todo.slice(i, i + 20).map(async (token) => {
  for (const ats of ['greenhouse', 'ashby', 'lever'] as Ats[]) {
    try {
      const all = await fetchBoard(ats, token);
      if (all.length === 0) continue;
      const n = all.filter(suits).length;
      if (n >= min) { db.query('INSERT INTO companies (name, ats, token) VALUES (?, ?, ?)').run(wanted.get(token)!, ats, token); added.push(`${wanted.get(token)} (${n})`); }
      return;
    } catch { /* no board by that name here */ }
  }
}));
console.log(`${todo.length} names tried, ${added.length} added: ${added.sort().join(', ')}`);
if (added.length > 0) console.log(await discover(Date.now(), false));
