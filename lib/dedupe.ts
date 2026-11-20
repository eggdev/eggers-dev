// The same fact often arrives from several sources: a resume bullet, the LinkedIn line for it, the
// repository that shows it. This finds those within one role and folds each set into one fact that
// keeps the most specific wording, every detail and all the evidence. A fact the person edited is
// never reworded: it is the one kept, and its duplicates are dropped. A fact told by the person (lib/derive.ts) is
// left out: only deriving its project again changes it.
import { db, foldFacts } from './db.ts';
import { ask } from './llm.ts';

type Row = { id: number; role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string; evidence: string; status: string };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['merges'], properties: { merges: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['keep', 'drop', 'text', 'detail', 'metric', 'skills'], properties: { keep: { type: 'number' }, drop: { type: 'array', items: { type: 'number' } }, text: { type: 'string' }, detail: { type: 'string' }, metric: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } } } } } } };

async function group(name: string, facts: Row[]): Promise<number> {
  if (facts.length < 2) return 0;
  const r = await ask<{ merges: { keep: number; drop: number[]; text: string; detail: string; metric: string; skills: string[] }[] }>({ cwd: process.cwd(), schema: SCHEMA, timeoutMs: 15 * 60_000, model: process.env.EGG_MODEL ?? 'opus',
    prompt: `These are facts about one part of a person's work history ("${name}"), gathered from several sources: a resume, a LinkedIn profile, code repositories, notes. Some say the same thing more than once.

Find each set of facts that state the same accomplishment, project, responsibility, skill or credential, and merge it into one.
- Merge only true duplicates: the same thing said again, perhaps with different wording or more or less detail. Two different things about the same project are not duplicates. When unsure, leave them apart.
- "keep" is the id of the fact to keep and "drop" the ids folded into it.
- "text" is the merged headline: one plain sentence, the most specific of the wordings, losing nothing true.
- "detail" combines what every version's detail says, without repeating itself.
- "metric" keeps the numbers exactly as given. If two versions give numbers that disagree, do not merge them.
- "skills" is the union.
- Never add anything that none of the versions says.
Return no entry for a fact that has no duplicate.

The facts, as JSON:
${JSON.stringify(facts.map((f) => ({ id: f.id, kind: f.kind, text: f.text, detail: f.detail, metric: f.metric, skills: f.skills })))}` });
  const byId = new Map(facts.map((f) => [f.id, f]));
  let gone = 0;
  db.transaction(() => {
    const used = new Set<number>();
    for (const m of r.merges) {
      const ids = [m.keep, ...m.drop].filter((id) => byId.has(id) && !used.has(id));
      if (ids.length < 2 || !ids.includes(m.keep)) continue;
      for (const id of ids) used.add(id);
      const rows = ids.map((id) => byId.get(id)!);
      // The person's own wording stands: keep the edited fact as it is.
      const edited = rows.find((f) => f.status === 'confirmed'), keep = edited ?? byId.get(m.keep)!;
      const evidence = [...new Set(rows.map((f) => f.evidence.trim()).filter(Boolean))].join(' · ').slice(0, 1200);
      if (edited) db.query('UPDATE facts SET evidence = ? WHERE id = ?').run(evidence, keep.id);
      else db.query('UPDATE facts SET text = ?, detail = ?, metric = ?, skills = ?, evidence = ? WHERE id = ?').run(m.text.trim() || keep.text, m.detail.trim(), m.metric.trim(), m.skills.join(', '), evidence, keep.id);
      // The dropped facts' marks and origins go to the fact that stays, before their rows go: when a dropped fact is
      // marked kept, the fact that stays is marked kept too.
      foldFacts(keep.id, rows.filter((f) => f.id !== keep.id).map((f) => f.id));
      for (const f of rows) if (f.id !== keep.id) { db.query('DELETE FROM facts WHERE id = ?').run(f.id); gone++; }
    }
  })();
  return gone;
}

// Folds duplicates in every role, four roles at a time. Returns how many facts were folded away.
export async function dedupe(): Promise<number> {
  const facts = db.query('SELECT id, role_id, kind, text, detail, metric, skills, evidence, status FROM facts WHERE told = 0 ORDER BY id').all() as Row[];
  const names = new Map((db.query('SELECT id, company, title FROM roles').all() as { id: number; company: string; title: string }[]).map((r) => [r.id, r.title ? `${r.title}, ${r.company}` : r.company]));
  const groups = new Map<number | null, Row[]>();
  for (const f of facts) groups.set(f.role_id, [...(groups.get(f.role_id) ?? []), f]);
  const queue = [...groups.entries()];
  let gone = 0;
  const run = async (): Promise<void> => {
    const next = queue.shift();
    if (!next) return;
    // The count is added after the wait: four of these run at once.
    try { const n = await group(next[0] === null ? 'General: skills, education' : names.get(next[0]) ?? 'a role', next[1]); gone += n; } catch (e) { console.log(`  could not check one role: ${(e as Error).message}`); }
    return run();
  };
  await Promise.all([run(), run(), run(), run()]);
  return gone;
}
