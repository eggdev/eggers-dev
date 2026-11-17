// "How you work": a few lines counted from the record, with no model (DESIGN.md section 8). Each line says what it
// was counted from and names the items behind it. Below its rule's minimum a line is not drawn at all: a count from too
// little reads as a claim. The owner keeps a line or says it is not true; a verdict can be undone. A line's key names
// its finding (the two kinds of result, the skill, the phrase), so a different finding is asked afresh; the numbers in a
// line are counted again each time it is shown, and are not part of its key. In this stage a kept line is stored and shown, nothing more:
// it is never sent to a model.
import { db } from './db.ts';
import type { MetricKind } from './metrics.ts';

export const SHOWN = 3;
export type DerivedFact = { id: string; roleId: string; projectId: string; text: string; metric: string; skills: string };
export type DerivedInput = {
  roles: { id: string }[];
  projects: { id: string; learned: string }[];
  facts: DerivedFact[];
  // The metrics inventory (lib/metrics.ts): which facts hold a measured result, and of which kind.
  metrics: { fact: string; kind: MetricKind }[];
  // The skills list (lib/skills.ts): kind is tool | language | platform | other; mark '' | confident | not-confident.
  skills: { name: string; kind: string; mark: string }[];
};
// items: the keys of what is behind the line ("fact:12", "project:3", "role:4"), for the screen to open them.
export type Line = { key: string; text: string; basis: string; items: string[] };

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
// A statement about a team the owner led or grew: "a team of 9", "managed/led a team", "managed 12 engineers",
// "hired 7", "mentored 3" or "mentored engineers", "direct reports". Not a passive or self-directed form ("was hired",
// "hired as", "was promoted"), and not "managed the migration": those say nothing about a team.
const LED = [
  /\bteam of \d/i,
  /\b(managed|led|ran|built|grew)\s+(a|the|my|an?\s+\w+)?\s*team\b/i,
  /\b(managed|led)\s+\d+\s+(engineers|people|reports|developers|designers|analysts|staff|managers)\b/i,
  /(?<!\b(was|were|been|got)\s)\bhired\s+(\d+|a team)\b/i,
  /\bmentored\s+(\d+|engineers|developers|people|junior|new)\b/i,
  /\bdirect reports?\b/i,
  /\b(coached|recruited)\s+\d+\b/i,
];
const ledTeam = (text: string) => LED.some((re) => re.test(text));
// Words that start or end no phrase worth naming.
const STOP = new Set('a an the and or of to in on at for with by from it its is was be i my me we our you your that this then than not but so as if into over more most any each every'.split(' '));

// Every line whose rule holds, in the rules' order: results, led, skill, measured, learned.
export function howYouWork(x: DerivedInput): Line[] {
  const out: Line[] = [];
  // results: the two commonest kinds of measured result, when they are most of at least 8.
  const m = x.metrics.length, byKind = new Map<string, string[]>();
  for (const r of x.metrics) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.fact]);
  const top = [...byKind].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 2);
  if (top.length === 2) {
    const n = top[0][1].length + top[1][1].length;
    if (m >= 8 && n > m / 2) out.push({ key: `results:${top[0][0]}+${top[1][0]}`, text: `Most of your measured results are about ${top[0][0]} and ${top[1][0]}: ${n} of ${m}.`,
      basis: `Counted from the ${m} measured results in your record.`, items: [...top[0][1], ...top[1][1]].map((id) => `fact:${id}`) });
  }
  // led: roles with a team-size result, or a fact about managing, hiring or growing a team.
  const teamFacts = new Set(x.metrics.filter((r) => r.kind === 'team size').map((r) => r.fact));
  const ledFacts = x.facts.filter((f) => f.roleId !== '' && (teamFacts.has(f.id) || ledTeam(f.text)));
  const ledRoles = new Set(ledFacts.map((f) => f.roleId)), n = x.roles.length;
  // The key names the finding, not its counts: a line said not to be true does not come back when a role is added.
  if (n >= 3 && ledRoles.size >= 2) out.push({ key: 'led', text: `Your record shows you managing, hiring or growing a team in ${ledRoles.size} of ${n} roles.`,
    basis: `Counted from ${many(ledFacts.length, 'fact')} about managing, hiring or the size of a team.`, items: ledFacts.map((f) => `fact:${f.id}`) });
  // skill: the skill (a tool, language or platform the owner has not said they are unsure of) in the most roles.
  const counted = x.skills.filter((s) => s.kind !== 'other' && s.mark !== 'not-confident').map((s) => {
    const named = (f: DerivedFact) => f.skills.split(',').some((k) => k.trim().toLowerCase() === s.name.toLowerCase());
    return { s, roles: [...new Set(x.facts.filter((f) => f.roleId !== '' && named(f)).map((f) => f.roleId))] };
  }).sort((a, b) => b.roles.length - a.roles.length || a.s.name.localeCompare(b.s.name));
  if (counted[0] && counted[0].roles.length >= 3) out.push({ key: `skill:${counted[0].s.name.toLowerCase()}`, text: `${counted[0].s.name} runs through ${counted[0].roles.length} of your ${n} roles.`,
    basis: 'Counted from the skills your facts name.', items: counted[0].roles.map((id) => `role:${id}`) });
  // measured: projects with at least one measured result, among 5 or more.
  const measuredFacts = new Set(x.metrics.map((r) => r.fact));
  const measured = x.projects.filter((p) => x.facts.some((f) => f.projectId === p.id && measuredFacts.has(f.id)));
  if (x.projects.length >= 5) out.push({ key: 'measured', text: `${measured.length} of your ${x.projects.length} projects have a measured result.`,
    basis: `Counted from your ${x.projects.length} projects and the numbers in their facts.`, items: measured.map((p) => `project:${p.id}`) });
  // learned: the longest phrase of 2 to 5 words that What I learned shares on 2 or more projects, once 4 have it.
  const said = x.projects.filter((p) => p.learned.trim() !== '');
  if (said.length >= 4) {
    const grams = new Map<string, { n: number; ids: Set<string> }>();
    for (const p of said) {
      const w = p.learned.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
      for (let k = 2; k <= 5; k++) for (let i = 0; i + k <= w.length; i++) {
        const g = w.slice(i, i + k);
        if (STOP.has(g[0]) || STOP.has(g[k - 1])) continue;
        const key = g.join(' ');
        if (!grams.has(key)) grams.set(key, { n: k, ids: new Set() });
        grams.get(key)!.ids.add(p.id);
      }
    }
    let best: { phrase: string; n: number; ids: Set<string> } | undefined;
    for (const [phrase, v] of grams) {
      if (v.ids.size < 2) continue;
      if (!best || v.ids.size > best.ids.size || (v.ids.size === best.ids.size && (v.n > best.n || (v.n === best.n && phrase < best.phrase)))) best = { phrase, ...v };
    }
    if (best) out.push({ key: `learned:${best.phrase}`, text: `What you say you learned most often: “${best.phrase}” (${best.ids.size} projects).`,
      basis: `Read from What I learned on ${many(said.length, 'project')}.`, items: [...best.ids].map((id) => `project:${id}`) });
  }
  return out;
}

export type Verdict = 'kept' | 'rejected';
export const verdicts = (): Map<string, Verdict> => new Map((db.query('SELECT key, verdict FROM derived_lines').all() as { key: string; verdict: Verdict }[]).map((r) => [r.key, r.verdict]));
// The lines shown: the first few that hold and that the owner has not said are not true, each with its verdict.
export const shownLines = (lines: Line[], judged: Map<string, Verdict>, n = SHOWN) =>
  lines.filter((l) => judged.get(l.key) !== 'rejected').slice(0, n).map((l) => ({ ...l, verdict: judged.get(l.key) ?? '' }));

// The owner's verdict on a line that holds now: kept, rejected, or '' to take a verdict back. A verdict the same as the
// stored one writes nothing. Returns '' when done, else why not, in a plain sentence.
export function judge(lines: Line[], key: string, verdict: string, now: number): string {
  if (!['kept', 'rejected', ''].includes(verdict)) return 'Say kept, rejected, or nothing to take a verdict back.';
  const stored = verdicts().get(key);
  if (verdict === '') {
    if (stored === undefined) return '';
    db.query('DELETE FROM derived_lines WHERE key = ?').run(key);
    return '';
  }
  const line = lines.find((l) => l.key === key);
  if (!line) return 'That line no longer holds for your record.';
  if (stored === verdict) return '';
  db.query('INSERT INTO derived_lines (key, verdict, text, basis, judged_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET verdict = excluded.verdict, text = excluded.text, basis = excluded.basis, judged_at = excluded.judged_at')
    .run(key, verdict, line.text, JSON.stringify(line.items), now);
  return '';
}
