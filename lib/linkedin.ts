// Rule 10, LinkedIn as data: the positions from the person's LinkedIn export, kept as rows, and how they
// differ from the bank's roles in title, employer, start and end. A background check and a recruiter both
// compare the two, so each difference is a question for the person: which one is right (lib/raised.ts).
// Nothing here decides for them. An answer of "LinkedIn is right" writes LinkedIn's value into the role.
//
// The export's zip is flattened to text when it is uploaded (server.ts, linkedinText), one "## <file>.csv"
// section per file. The positions are read from that text's "## Positions.csv" section.
import { db, type RoleRow } from './db.ts';
import { normCompany } from './entries.ts';
import { answeredRaised, onAnswer, raise, type Finding, type Raised } from './raised.ts';
import { monthText, sameDate, toYm } from './resume.ts';

// start and end are YYYY-MM (or YYYY), as in roles; an empty end is the present. The newest export read replaces the rows.
db.run(`CREATE TABLE IF NOT EXISTS linkedin_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, title TEXT NOT NULL, start TEXT NOT NULL DEFAULT '', end TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '', source_id INTEGER, read_at INTEGER NOT NULL)`);

export type Position = { company: string; title: string; start: string; end: string; location: string };
export type Diff = { key: string; field: 'title' | 'company' | 'start' | 'end' | 'missing' | 'absent'; role?: number; bank: string; linkedin: string; text: string; choices: string[]; position?: Position };

// CSV as LinkedIn writes it: quoted fields may hold commas, line breaks and doubled quotes.
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// The positions in a Positions.csv, or in a flattened export that holds one. [] when there is none.
export function positionsIn(text: string): Position[] {
  const at = text.search(/^## Positions\.csv\s*$/m);
  const body = at < 0 ? text : text.slice(text.indexOf('\n', at) + 1).split(/^## [^\n]+\.csv\s*$/m)[0];
  const rows = csvRows(body), head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name), c = col('company name'), t = col('title');
  if (c < 0 || t < 0) return [];
  const get = (r: string[], i: number) => (i < 0 ? '' : (r[i] ?? '').trim());
  return rows.slice(1).map((r) => ({ company: get(r, c), title: get(r, t), start: toYm(get(r, col('started on'))), end: toYm(get(r, col('finished on'))), location: get(r, col('location')) })).filter((p) => p.company !== '');
}

export const positions = () => db.query('SELECT company, title, start, end, location FROM linkedin_positions ORDER BY id').all() as Position[];
// Keeps the positions of an export just read, in place of any earlier export's. Returns how many. A text with no positions changes nothing.
export function storePositions(text: string, sourceId: number | null, now: number): number {
  const found = positionsIn(text);
  if (found.length === 0) return 0;
  db.transaction(() => {
    db.run('DELETE FROM linkedin_positions');
    for (const p of found) db.query('INSERT INTO linkedin_positions (company, title, start, end, location, source_id, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.company, p.title, p.start, p.end, p.location, sourceId, now);
  })();
  return found.length;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const say = (ym: string) => (ym === '' ? 'Present' : monthText(ym));

// Pairs each position with the role it is, then lists where a pair differs, and what only one side has.
// A pair is made, in turn: by employer and title; by employer alone, when the start date or the count leaves
// one choice; by title and start date. Roles compared are the person's jobs: those with a title that are not
// filed under another role and are not personal projects.
// `separate` are a position and a role the person said are two different jobs: they are never paired again.
export function diffPositions(found: Position[], roles: RoleRow[], separate: { role: number; title: string }[] = []): Diff[] {
  const jobs = roles.filter((r) => r.title.trim() !== '' && r.part_of === null && r.standing !== 'personal');
  const apart = (p: Position, r: RoleRow) => separate.some((x) => x.role === r.id && norm(x.title) === norm(p.title));
  const left = [...found], free = [...jobs], pairs: { p: Position; r: RoleRow }[] = [];
  const take = (match: (p: Position, r: RoleRow) => boolean, single = false) => {
    for (const p of [...left]) {
      const fits = free.filter((r) => match(p, r) && !apart(p, r));
      if (fits.length === 0 || (single && (fits.length > 1 || left.filter((x) => match(x, fits[0])).length > 1))) continue;
      const r = fits.find((x) => sameDate(x.start, p.start)) ?? fits[0];
      pairs.push({ p, r }); left.splice(left.indexOf(p), 1); free.splice(free.indexOf(r), 1);
    }
  };
  const company = (p: Position, r: RoleRow) => normCompany(p.company) === normCompany(r.company);
  take((p, r) => company(p, r) && norm(p.title) === norm(r.title));
  take((p, r) => company(p, r) && r.start !== '' && sameDate(p.start, r.start));
  take(company, true);
  take((p, r) => norm(p.title) === norm(r.title) && r.start !== '' && sameDate(p.start, r.start), true);
  const out: Diff[] = [];
  for (const { p, r } of pairs) {
    const where = `${r.title} at ${r.company}`;
    // The key holds LinkedIn's value, so a later export with another value for the same field is asked again.
    const add = (field: 'title' | 'company' | 'start' | 'end', bank: string, linkedin: string, what: string) => out.push({ key: `linkedin:${field}:${r.id}:${norm(linkedin)}`, field, role: r.id, bank, linkedin, position: p,
      text: `Your record says ${what} “${field === 'start' || field === 'end' ? say(bank) : bank}”. LinkedIn says “${field === 'start' || field === 'end' ? say(linkedin) : linkedin}”. A background check compares them. Which one is right?`,
      // A position paired by its employer alone may be a different, real title (a promotion): the person can say so.
      choices: [`Your record is right: ${field === 'start' || field === 'end' ? say(bank) : bank}`, `LinkedIn is right: ${field === 'start' || field === 'end' ? say(linkedin) : linkedin}`, ...(field === 'title' ? [SEPARATE] : [])] });
    if (norm(p.title) !== norm(r.title)) add('title', r.title, p.title, `your title at ${r.company} was`);
    if (!company(p, r)) add('company', r.company, p.company, `the employer for ${r.title} was`);
    if (r.start !== '' && p.start !== '' && !sameDate(p.start, r.start)) add('start', r.start, p.start, `${where} started in`);
    if (r.start !== '' && !sameDate(p.end, r.end)) add('end', r.end, p.end, `${where} ended in`);
  }
  for (const p of left) out.push({ key: `linkedin:missing:${normCompany(p.company)}|${norm(p.title)}|${p.start}`, field: 'missing', bank: '', linkedin: `${p.title}, ${p.company}`, position: p,
    text: `LinkedIn lists ${p.title} at ${p.company}${p.start ? ` (${say(p.start)} to ${say(p.end)})` : ''}. Your record has no such job. Which one is right?`, choices: ['LinkedIn is right: add this job to my record', 'Your record is right: it is not a job of mine'] });
  for (const r of free) out.push({ key: `linkedin:absent:${r.id}`, field: 'absent', role: r.id, bank: `${r.title}, ${r.company}`, linkedin: '',
    text: `Your record has ${r.title} at ${r.company}${r.start ? ` (${say(r.start)} to ${say(r.end)})` : ''}. LinkedIn does not list it. Which one is right?`, choices: ['Your record is right: LinkedIn leaves it out', 'I will add it to LinkedIn'] });
  return out;
}

const SEPARATE = 'Both are right: they were separate roles';
// Asks about each difference between the stored positions and the roles. With no export read, nothing is asked.
// Where the person answered that a position and a role were separate roles, the two are compared apart from then on.
export function syncLinkedin(now: number): Diff[] {
  const found = positions();
  const separate = answeredRaised('linkedin', false).filter((q) => q.answer === SEPARATE).map((q) => ({ role: Number(q.data.role), title: String(q.data.linkedin ?? '') }));
  const diffs = found.length === 0 ? [] : diffPositions(found, db.query('SELECT * FROM roles').all() as RoleRow[], separate);
  raise('linkedin', diffs.map((d): Finding => ({ key: d.key, text: d.text, choices: d.choices, about: d.role ? `role:${d.role}` : '', data: { field: d.field, role: d.role ?? 0, bank: d.bank, linkedin: d.linkedin, position: d.position ?? null } })), now);
  return diffs;
}

// "LinkedIn is right" puts LinkedIn's value in the role, or adds the job LinkedIn lists. "The bank is right" and
// "Both are right: they were separate roles" change nothing in the bank: the answer alone is recorded.
onAnswer('linkedin', (q: Raised, choice: number) => {
  const field = String(q.data.field), role = Number(q.data.role), p = q.data.position as Position | null;
  if (field === 'missing' && choice === 0 && p) db.query("INSERT INTO roles (company, title, start, end, location, standing) VALUES (?, ?, ?, ?, ?, 'employer')").run(p.company, p.title, p.start, p.end, p.location);
  else if (['title', 'company', 'start', 'end'].includes(field) && choice === 1) db.query(`UPDATE roles SET "${field}" = ? WHERE id = ?`).run(String(q.data.linkedin ?? ''), role);
  return '';
});
