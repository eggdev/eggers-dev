// `bun tools/public.ts`: writes a draft of the public collection, the only material a public
// assistant may answer from. The draft is the whole bank as plain Markdown: each role with its
// facts, then the facts that belong to no role, then the profile. No model writes it, so it says
// only what the bank says.
//
// Nothing here publishes. The draft goes to .data/public/collection.draft.md, which git ignores.
// The person reads it, deletes whatever must not be public, and saves the result beside it as
// collection.md. Only that file is ever shipped, and this command never writes it.
// A second file, collection.review.md, lists the draft's lines that deserve a second look: money,
// percentages and counts, people and clients, links and addresses, words such as "internal".
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db, KINDS } from '../lib/db.ts';
import { inData } from '../lib/paths.ts';

type Role = { id: number; company: string; title: string; start: string; end: string; summary: string; standing: string; part_of: number | null };
type Fact = { role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string };

const roles = db.query('SELECT id, company, title, start, end, summary, standing, part_of FROM roles ORDER BY start DESC, id').all() as Role[];
const facts = db.query('SELECT role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all() as Fact[];
const profile = ((db.query('SELECT body FROM profile WHERE id = 1').get() as { body: string } | null)?.body ?? '').trim();

const HEADINGS: Record<string, string> = { accomplishment: 'What was delivered', project: 'Projects', responsibility: 'Responsibilities', skill: 'Skills', education: 'Education', other: 'Other' };
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
// One fact, one bullet: the fact, then its detail and its measure when it has them.
const bullet = (f: Fact) => `- ${[one(f.text), one(f.detail), f.metric.trim() ? `Measured: ${one(f.metric)}` : ''].filter(Boolean).join(' ')}`;
function listed(mine: Fact[], level: string): string[] {
  const out: string[] = [];
  for (const kind of KINDS) {
    const of = mine.filter((f) => f.kind === kind);
    if (of.length > 0) out.push(`${level} ${HEADINGS[kind]}`, '', ...of.map(bullet), '');
  }
  return out;
}
const dates = (r: Role) => (r.start || r.end ? ` (${[r.start, r.end || 'now'].filter(Boolean).join(' to ')})` : '');
const named = (r: Role) => [r.title, r.company].filter(Boolean).join(', ');

const lines: string[] = ['# Public collection', ''];
// An employer first, then the project groups filed under it.
for (const r of roles.filter((x) => x.part_of === null)) {
  lines.push(`## ${named(r)}${dates(r)}`, '');
  if (r.summary.trim()) lines.push(one(r.summary), '');
  lines.push(...listed(facts.filter((f) => f.role_id === r.id), '###'));
  for (const p of roles.filter((x) => x.part_of === r.id)) {
    lines.push(`### Project: ${named(p)}${dates(p)}`, '');
    if (p.summary.trim()) lines.push(one(p.summary), '');
    lines.push(...listed(facts.filter((f) => f.role_id === p.id), '####'));
  }
}
const loose = facts.filter((f) => f.role_id === null);
if (loose.length > 0) lines.push('## Not tied to one role', '', ...listed(loose, '###'));
if (profile) lines.push('## Overview, from the profile', '', profile.replace(/^# /gm, '### ').replace(/^## /gm, '### '), '');

// Lines a person should look at twice before they are public. A reason, not a verdict.
const CHECKS: [string, RegExp][] = [
  ['money', /[$€£]\s?\d|\b\d[\d,.]*\s?(?:k|m|mm|million|billion)\b|\b(?:revenue|budget|salary|profit|margin|valuation|funding|invoice|cost savings?|arr|mrr)\b/i],
  ['a percentage or a count', /\d\s?%|\b\d[\d,]{2,}\b/],
  ['a person, client or partner', /\b(?:client|customer|tenant|resident|investor|vendor|partner|ceo|cfo|cto|coo|founder|manager|my boss|reported to)\b/i],
  ['a link or an address', /https?:\/\/|\b[\w.-]+@[\w.-]+\.\w+|\b[\w-]+\.(?:com|io|dev|net|org|app)\b/i],
  ['inside knowledge', /\b(?:internal|confidential|nda|proprietary|unreleased|not public|acquisition|lawsuit|layoff|incident|outage|breach|security)\b/i],
];
const review: string[] = ['# Lines to look at twice', '', 'Each line of the draft that matched a check, with the reason. A match is a prompt to look, not a finding.', ''];
let flagged = 0;
lines.forEach((l, i) => {
  if (!l.startsWith('- ') && !/^[A-Za-z]/.test(l)) return;
  const why = CHECKS.filter(([, re]) => re.test(l)).map(([name]) => name);
  if (why.length > 0) { flagged++; review.push(`- Line ${i + 1} (${why.join('; ')}): ${l.replace(/^- /, '').slice(0, 220)}`); }
});

const dir = inData('public');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'collection.draft.md'), `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`);
writeFileSync(join(dir, 'collection.review.md'), `${review.join('\n')}\n`);
const text = lines.join('\n');
console.log(`draft: ${join(dir, 'collection.draft.md')} (${roles.length} roles, ${facts.length} facts, ${text.length.toLocaleString('en-US')} characters)`);
console.log(`look twice: ${join(dir, 'collection.review.md')} (${flagged} lines)`);
console.log(existsSync(join(dir, 'collection.md'))
  ? 'collection.md, the approved file, is there and was not touched.'
  : 'Nothing is public yet. Edit the draft and save what may be public as collection.md in the same folder.');
