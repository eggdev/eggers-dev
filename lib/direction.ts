// The person's own direction notes: who they are aiming to be, the tracks they want, their
// constraints, a fit test for a listing, and how they want their resume shaped. Written by them in
// Markdown and kept whole. It steers every prompt: which roles the profile argues for, how jobs and
// leads are judged, how a resume is ordered.
// One rule comes from the notes themselves: a section they mark as a lens for fit only (their
// numerology profile) informs fit and motivation and is kept out of anything written for an employer.
import { db } from './db.ts';

db.run("CREATE TABLE IF NOT EXISTS direction (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)");
db.run('INSERT OR IGNORE INTO direction (id) VALUES (1)');

const DEFAULT_TARGETS = ['Tech lead or player-coach', 'Forward-deployed or solutions engineer', 'Founding or lead engineer'];
export const direction = () => (db.query('SELECT body FROM direction WHERE id = 1').get() as { body: string }).body;
export const saveDirection = (body: string, now: number) => db.query('UPDATE direction SET body = ?, updated_at = ? WHERE id = 1').run(body.trim(), now);

// A Markdown section by its heading's opening words, without the heading; '' when there is none.
const section = (body: string, starts: RegExp) => {
  const lines = body.split('\n'), i = lines.findIndex((l) => /^##\s/.test(l) && starts.test(l.replace(/^##\s*/, '')));
  if (i < 0) return '';
  const j = lines.findIndex((l, k) => k > i && /^##\s/.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join('\n').trim();
};

// The tracks the person named ("- A. Build and teach AI inside a company (…)"), else the defaults.
export function targets(): string[] {
  const found = section(direction(), /^target tracks/i).split('\n').map((l) => l.replace(/^[-*]\s*(?:[A-Z0-9]+[.)]\s*)?/, '').replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean);
  return found.length > 0 ? found : DEFAULT_TARGETS;
}
// The questions of the person's own fit test for a listing; [] when they wrote none.
export const fitTest = () => section(direction(), /^fit test/i).split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim()).filter((l) => l.endsWith('?'));

// For anything an employer will read (the profile, a resume): the notes without the fit-only lens.
export function directionForMaterials(): string {
  const lines = direction().split('\n'), out: string[] = [];
  let skip = false;
  for (const l of lines) {
    if (/^##\s/.test(l)) skip = /numerolog|astrolog|human design|enneagram/i.test(l);
    if (!skip && !/numerolog/i.test(l)) out.push(l);
  }
  return out.join('\n').trim();
}

// The lowest salary the person would take, from a line of their notes that says "Nothing under $100,000"; 0 when they give none.
export const payFloor = () => Number((direction().match(/nothing under \$?([\d,]+)/i)?.[1] ?? '0').replace(/,/g, '')) || 0;
