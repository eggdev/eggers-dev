// `bun tools/unslop.ts`: rewords the bank's facts to the writing rules (lib/writing.ts) without
// changing what any of them says. Facts the person edited themselves are left alone. Backs the
// database up first and writes every change, before and after, to .data/unslop.md.
import { copyFileSync, writeFileSync } from 'node:fs';
import { db } from '../lib/db.ts';
import { ask } from '../lib/llm.ts';
import { inData } from '../lib/paths.ts';
import { WRITING } from '../lib/writing.ts';

copyFileSync(inData('egg.db'), inData('egg.db.before-unslop'));
type Fact = { id: number; text: string };
const facts = db.query("SELECT id, text FROM facts WHERE status != 'confirmed' AND kind != 'skill' AND length(text) > 30 ORDER BY id").all() as Fact[];
const SCHEMA = { type: 'object', additionalProperties: false, required: ['facts'], properties: { facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'number' }, text: { type: 'string' } } } } } };
const batches: Fact[][] = [];
for (let i = 0; i < facts.length; i += 30) batches.push(facts.slice(i, i + 30));
const log: string[] = [];
let changed = 0;
const next = async (): Promise<void> => {
  const batch = batches.shift();
  if (!batch) return;
  try {
    const r = await ask<{ facts: Fact[] }>({ cwd: process.cwd(), schema: SCHEMA, timeoutMs: 10 * 60_000, model: process.env.EGG_MODEL ?? 'opus',
      prompt: `Each item below is one fact from a person's record of their work: a single sentence, past tense, no leading pronoun. Reword only the ones that break the wording rules, and return only those, with the same id.

What must not change: the meaning, and every number, name, technology, date and outcome, each exactly as written. Add nothing the sentence does not already say. If a sentence ends in a benefit it does not evidence ("..., improving reliability"), drop that clause. If a fact is already plain, leave it out of your answer. Keep it one sentence, or two short ones where one sentence held two ideas.

${WRITING}

The facts, as JSON:
${JSON.stringify(batch)}` });
    const before = new Map(batch.map((f) => [f.id, f.text]));
    for (const f of r.facts) {
      const old = before.get(f.id), text = f.text.trim();
      if (!old || text === '' || text === old) continue;
      // A rewrite that loses or gains a number is refused: the numbers are the facts.
      const nums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]$/, '')).sort().join(' ');
      if (nums(old) !== nums(text)) { log.push(`REFUSED (numbers differ) ${f.id}\n- was: ${old}\n- offered: ${text}\n`); continue; }
      db.query('UPDATE facts SET text = ? WHERE id = ?').run(text, f.id);
      log.push(`${f.id}\n- was: ${old}\n- now: ${text}\n`);
      changed++;
    }
    console.log(`  ${changed} reworded`);
  } catch (e) { console.log(`  a batch failed: ${(e as Error).message}`); }
  return next();
};
await Promise.all([next(), next(), next()]);
writeFileSync(inData('unslop.md'), log.join('\n'));
console.log(`${changed} of ${facts.length} facts reworded. Before and after: ${inData('unslop.md')}`);
