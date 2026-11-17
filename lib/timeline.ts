// Rule 4, the timeline: what in the person's roles a reader would stop at. A pure function over the roles,
// with no database and no model. It never proposes a fix. Each finding that needs the person carries a
// question with the choices the rule names, and what each choice would change in the data.
//
// What is looked at: jobs with a start date. A project group filed under an employer (`part_of`) is that
// employer's work, so the two are never compared with each other. A personal project is not a job and is left
// out, as is a repository's project group with no title unless it is classed as the person's own company or
// as contract work.
import type { RoleRow } from './db.ts';
import { employers, labelOf, normCompany } from './entries.ts';
import { monthText } from './resume.ts';

// What a choice changes: one field of one role. `value` is fixed for a label; for an end date or a note the
// person supplies it. `none` records the answer and changes nothing.
export type Action = { role: number; field: 'end' | 'note' | 'label'; value?: string } | { role: number[]; field: 'label'; value: string } | { field: 'none' };
export type Finding = { kind: 'two-current' | 'overlap' | 'repeat-employer' | 'short-stints'; key: string; roles: number[]; text: string;
  question?: { text: string; choices: string[]; actions: Action[] } };

const months = (ym: string, last = false) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m ? m - 1 : last ? 11 : 0); };
const name = (r: RoleRow) => (r.title ? `${r.title} at ${r.company}` : r.company);
const when = (r: RoleRow) => `${monthText(r.start)} to ${r.end === '' ? 'now' : monthText(r.end)}`;
const isJob = (r: RoleRow) => r.start !== '' && r.standing !== 'personal' && (r.title.trim() !== '' || r.standing === 'own' || r.standing === 'contract');
const related = (a: RoleRow, b: RoleRow) => a.part_of === b.id || b.part_of === a.id;
const explained = (r: RoleRow) => (r.note ?? '').trim() !== '';

export function timeline(roles: RoleRow[], now: number): Finding[] {
  const today = new Date(now).getFullYear() * 12 + new Date(now).getMonth();
  const jobs = roles.filter(isJob).sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const end = (r: RoleRow) => (r.end === '' ? today : months(r.end, true));
  const out: Finding[] = [];
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const a = jobs[i], b = jobs[j];
    if (related(a, b)) continue;
    // Two roles that both say Present. An end date or a one-line note settles it; only the person knows which.
    if (a.end === '' && b.end === '') {
      if (explained(a) || explained(b)) continue;
      out.push({ kind: 'two-current', key: `two-current:${a.id}:${b.id}`, roles: [a.id, b.id], text: `${name(a)} and ${name(b)} both say Present, and nothing on the resume explains how they relate.`,
        question: { text: `Your record says you are at both ${name(a)} and ${name(b)} now. A reader will ask if you hold two jobs. Which is right?`,
          choices: [`${name(a)} has ended: give its end date`, `${name(b)} has ended: give its end date`, 'Both are current: write one line that says how they relate'],
          actions: [{ role: a.id, field: 'end' }, { role: b.id, field: 'end' }, { role: b.id, field: 'note' }] } });
      continue;
    }
    // The same employer's rows are one entry on the resume, so their dates are not two jobs at once.
    if (normCompany(a.company) === normCompany(b.company)) continue;
    const shared = Math.min(end(a), end(b)) - Math.max(months(a.start), months(b.start));
    if (shared <= 1 || labelOf(a) !== '' || labelOf(b) !== '' || explained(a) || explained(b)) continue;
    // A date that is only a year could be any month of it, so the count is the most it can be, and is said so.
    const by = [a.start, a.end, b.start, b.end].some((d) => d.length === 4) ? `by up to ${shared} months (some of these dates are a year with no month)` : `by ${shared} months`;
    out.push({ kind: 'overlap', key: `overlap:${a.id}:${b.id}`, roles: [a.id, b.id], text: `${name(a)} (${when(a)}) and ${name(b)} (${when(b)}) overlap ${by}, with no label or note.`,
      question: { text: `${name(a)} (${when(a)}) and ${name(b)} (${when(b)}) overlap ${by}. Was one of them contract or part-time work, was it a transition, or are the dates wrong?`,
        choices: [`${name(a)} was contract work`, `${name(b)} was contract work`, `${name(a)} was part-time`, `${name(b)} was part-time`, 'It was a transition: write one line that says so', `The dates are wrong: correct the end of ${name(a)}`],
        actions: [{ role: a.id, field: 'label', value: 'Contract' }, { role: b.id, field: 'label', value: 'Contract' }, { role: a.id, field: 'label', value: 'Part-time' }, { role: b.id, field: 'label', value: 'Part-time' }, { role: b.id, field: 'note' }, { role: a.id, field: 'end' }] } });
  }
  const groups = employers(roles).map((g) => ({ ...g, rows: g.rows.filter(isJob) })).filter((g) => g.rows.length > 0);
  // The same employer in several rows: the resume shows it as one entry. Nothing to ask.
  for (const g of groups.filter((x) => x.rows.length > 1)) {
    out.push({ kind: 'repeat-employer', key: `repeat:${g.rows.map((r) => r.id).sort((a, b) => a - b).join(':')}`, roles: g.rows.map((r) => r.id), text: `${g.company} is in your record ${g.rows.length} times. The resume shows it as one entry with each title and date range.` });
  }
  // Three or more stints under twelve months, one after another, with nothing that says why.
  const order = [...groups].sort((a, b) => a.rows.map((r) => r.start).sort()[0].localeCompare(b.rows.map((r) => r.start).sort()[0]));
  const short = (g: (typeof groups)[number]) => g.rows.every((r) => r.end !== '' && labelOf(r) === '' && !explained(r))
    && Math.max(...g.rows.map((r) => months(r.end, true))) - Math.min(...g.rows.map((r) => months(r.start))) + 1 < 12;
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && short(order[j])) j++;
    if (j - i >= 3) {
      const run = order.slice(i, j), ids = run.flatMap((g) => g.rows.map((r) => r.id));
      out.push({ kind: 'short-stints', key: `short-stints:${ids.join(':')}`, roles: ids, text: `${run.length} jobs in a row lasted under a year each: ${run.map((g) => g.company).join(', ')}.`,
        question: { text: `${run.length} jobs in a row lasted under a year each (${run.map((g) => g.company).join(', ')}). A reader will ask why. Were they contract work, or should the resume group them?`,
          choices: ['They were contract work: label each one Contract', 'Group them into one line on the resume', 'Leave them as they are'],
          actions: [{ role: ids, field: 'label', value: 'Contract' }, { field: 'none' }, { field: 'none' }] } });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}
