// The public collection: the only text a public assistant may answer from. Software never decides
// what is public. It makes a draft from the bank as a starting point, and it points at lines that
// deserve a second look. The saved collection is exactly the text the person sends to be saved.
// Nothing here saves a draft, and importing this file does nothing on its own.
//
// The saved text lives in the data folder as public/collection.md. The publishing step reads it
// through the server's GET /public, never from the draft.
import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inData } from './paths.ts';

// The longest collection taken. A public assistant reads all of it with every question.
export const MAX_COLLECTION = 120_000;
export const SAVED = 'collection.md';

type Role = { id: number; company: string; title: string; start: string; end: string; summary: string; standing: string; part_of: number | null };
type Fact = { role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string };

// One heading for each kind of fact, in the order the bank lists them (KINDS in lib/db.ts).
const HEADINGS: Record<string, string> = { accomplishment: 'What was delivered', project: 'Projects', responsibility: 'Responsibilities', skill: 'Skills', education: 'Education', other: 'Other' };
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
// One fact, one bullet: the fact, then its detail and its measure when it has them.
const bullet = (f: Fact) => `- ${[one(f.text), one(f.detail), f.metric.trim() ? `Measured: ${one(f.metric)}` : ''].filter(Boolean).join(' ')}`;
function listed(mine: Fact[], level: string): string[] {
  const out: string[] = [];
  for (const kind of Object.keys(HEADINGS)) {
    const of = mine.filter((f) => f.kind === kind);
    if (of.length > 0) out.push(`${level} ${HEADINGS[kind]}`, '', ...of.map(bullet), '');
  }
  return out;
}
const dates = (r: Role) => (r.start || r.end ? ` (${[r.start, r.end || 'now'].filter(Boolean).join(' to ')})` : '');
const named = (r: Role) => [r.title, r.company].filter(Boolean).join(', ');

// The draft: each employer with its facts and its project groups, then the facts that belong to no
// role, then the profile. No model writes it, so it says only what the bank says. It saves nothing.
// The handle is passed in, so a test can use a scratch database without opening the real one.
export function draftCollection(d: Database): string {
  const roles = d.query('SELECT id, company, title, start, end, summary, standing, part_of FROM roles ORDER BY start DESC, id').all() as Role[];
  const facts = d.query('SELECT role_id, kind, text, detail, metric, skills FROM facts ORDER BY id').all() as Fact[];
  const profile = ((d.query('SELECT body FROM profile WHERE id = 1').get() as { body: string } | null)?.body ?? '').trim();
  const lines: string[] = ['# Public collection', ''];
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
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// Lines a person should look at twice before they are public. A reason, not a verdict.
const CHECKS: [string, RegExp][] = [
  ['money', /[$€£]\s?\d|\b\d[\d,.]*\s?(?:k|m|mm|million|billion)\b|\b(?:revenue|budget|salary|profit|margin|valuation|funding|invoice|cost savings?|arr|mrr)\b/i],
  ['a percentage or a count', /\d\s?%|\b\d[\d,]{2,}\b/],
  ['a person, client or partner', /\b(?:client|customer|tenant|resident|investor|vendor|partner|ceo|cfo|cto|coo|founder|manager|my boss|reported to)\b/i],
  ['a link or an address', /https?:\/\/|\b[\w.-]+@[\w.-]+\.\w+|\b[\w-]+\.(?:com|io|dev|net|org|app)\b/i],
  ['inside knowledge', /\b(?:internal|confidential|nda|proprietary|unreleased|not public|acquisition|lawsuit|layoff|incident|outage|breach|security)\b/i],
];

export type Note = { line: number; kind: string; text: string };

// One note for each check a line matches. Lines count from 1. Blank lines and headings are skipped:
// a heading is a role's title and dates, where words such as "Manager" would only add noise.
export function reviewNotes(text: string): Note[] {
  const notes: Note[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
    if (l.trim() === '' || /^\s*#/.test(l)) return;
    for (const [kind, re] of CHECKS) if (re.test(l)) notes.push({ line: i + 1, kind, text: l.slice(0, 200) });
  });
  return notes;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// The saved collection as it is on disk, with when it was saved and its fingerprint.
export function readSaved(dir = inData('public')): { text: string; savedAt: number | null; sha256: string | null } {
  const file = join(dir, SAVED);
  if (!existsSync(file)) return { text: '', savedAt: null, sha256: null };
  const text = readFileSync(file, 'utf8');
  return { text, savedAt: Math.floor(statSync(file).mtimeMs), sha256: sha256(text) };
}

// Saves the person's text as the collection. It is written beside the old one and then moved over
// it, so a reader never sees half a file. Line endings become \n, and the text ends with one \n.
export function saveCollection(text: string, dir = inData('public')): { savedAt: number; sha256: string } {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('The collection is empty. Write what may be public, then save.');
  const clean = `${text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')}\n`;
  if (clean.length > MAX_COLLECTION) throw new Error(`The collection is over ${MAX_COLLECTION.toLocaleString('en-US')} characters. Shorten it, then save.`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, SAVED), temp = join(dir, `.${SAVED}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, clean);
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
  return { savedAt: Math.floor(statSync(file).mtimeMs), sha256: sha256(clean) };
}
