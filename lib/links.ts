// Rule 7, "The resume is the screen": each line of a resume a model writes names the facts it draws on. The writer, the
// council's reviser and the skim's fix end each bullet, and the Summary's paragraph, with the keys of those facts in
// braces ("… {fact:2}" or "… {fact:2, fact:7}", LINKS in lib/writing.ts). Code takes the keys out at once (takeLinks,
// called by tidy in lib/jobs.ts), so no stored or printed text and no reader of the resume ever sees one; the links
// are kept beside the text, in `jobs.links`:
//   { v: 1, lines: [{ where: summary | bullet, entry, text, facts, edited }] }
// A line is found by where it is, its entry (the employer, as normCompany reads it) and its text. '' in `jobs.links`
// means the resume was written before links existed, or with EGG_LINKS=off: then no link is checked or shown.
//
// What code checks (checkLinks), every time a resume's flags are taken: each cited fact exists, belongs to the line's
// own employer (the Summary may cite any), and holds every number of the line, by value (lib/numbers.ts, the same
// reading as the context check). It cannot check that the words of a line say what its facts say: a link is the
// writer's statement, and the owner's check is the fact shown beside the line. A key is never repaired by a guess.
//
// When the owner edits the text (carry): an unchanged line keeps its link; a line replaced in place (one line out and
// one in, at the same place in the same entry) keeps its facts, marked with the time of the edit, and its numbers are
// still checked; any other line the owner added, moved to another entry or merged has no link.
// This file opens no database and asks no model.
import type { RoleRow } from './db.ts';
import { employers, groupOf, normCompany } from './entries.ts';
import { unheld } from './numbers.ts';
import { lf, parseResume } from './resume.ts';
import { factRef } from './tree.ts';

export type Where = 'summary' | 'bullet';
// facts: the fact ids the line cites, as the writer gave them (a fact deleted since is still listed: the check says so).
// refused: keys that are no fact ("project:3", "role:2"), kept so the check can say why. edited: when the owner's edit
// replaced the line in place (its facts were linked before that edit), or 0.
export type LinkLine = { where: Where; entry: string; text: string; facts: number[]; edited: number; refused?: string[] };
export type Links = { v: 1; lines: LinkLine[] };
// A line's keys as takeLinks read them, before code puts the headings and the Skills line right.
export type Cite = { where: Where; text: string; facts: number[]; refused: string[] };
// A line of the resume that can carry a link: the Summary (one, whatever its lines) or a bullet of an Experience entry.
// `n` is the entry's place among the Experience entries (-1 for the Summary).
export type Place = { where: Where; entry: string; text: string; line: number; n: number };

// EGG_LINKS=off leaves out the links text, the annotation and the link findings: the way back needs no deploy.
export const linksOn = () => process.env.EGG_LINKS !== 'off';

// ---------- Keys in a model's text ----------
// A key is taken out wherever a model put it, in whatever near shape: in braces, square, round or angle brackets, or
// escaped braces ("{fact:2}", "[fact:2]", "\{fact:2\}", "<fact:2>"), with any separators ("{fact:1; fact:3}",
// "{fact:1 and fact:3}", "{fact:1, fact:3,}"), quoted ("{"fact:1"}"), as a plural ("{facts: 1, 3}"), with other marks
// between the word and the number ("{fact 1}", "{fact:#1}", "{fact_1}", "{fact：1}"), or as a reference ("{F-0001}").
// A group is a key only when everything in it is key text and it opens with a key word or a reference, so "{TBD}",
// "{id}", "(F-16 program)", "{42}", "[3 facts]" and "(facts 2023-2024)" stay. Round and angle brackets, which prose uses,
// hold a key only with the word "fact": "(F-0012)" and "(role: 2)" in a sentence are the owner's words.
// Its ids are taken when they can be read without a guess; a number that belongs to no key ("{fact:1, 3}") makes the
// whole group unreadable: it is still taken out, and gives the line nothing.
const GROUP = /(\\?[{[(<])([^{}[\]()<>\n]*?)(\\?[}\])>])/g;
const TAIL = /(\\?[{[(<])([^{}[\]()<>\n]*)$/;
const KEY_TEXT = /^(?:[\s,;:#.&"'`*\\]|and\b|facts?\b|projects?\b|roles?\b|F-\d{4,}|\d+)*$/i;
const KEY_START = /^[\s"'`*\\]*(?:facts?\b|projects?\b|roles?\b|F-\d{4,})/i;
const ABOUT_KEY = /\bfacts?\b[^\d\n]{0,4}\d|\bF-\d{4,}|\b(?:project|role)s?\s*:\s*\d/i;
const norm = (inner: string) => inner.replace(/_/g, ' ').replace(/：/g, ':');
const isKey = (inner: string, open = '{') => {
  const t = norm(inner);
  return t.trim() !== '' && KEY_TEXT.test(t) && KEY_START.test(t) && ABOUT_KEY.test(t) && (!/[(<]/.test(open) || /\bfacts?\b[^\d\n]{0,4}\d/i.test(t));
};
// The ids of a key group, or null when a number in it belongs to no key.
function readKey(inner: string): { facts: number[]; refused: string[] } | null {
  let kind = '', used = 0;
  const facts: number[] = [], refused: string[] = [];
  for (const tok of norm(inner).match(/F-\d+|facts?|projects?|roles?|\d+/gi) ?? []) {
    const low = tok.toLowerCase();
    if (/^f-\d+$/.test(low)) { facts.push(Number(low.slice(2))); kind = ''; continue; }
    if (/^(facts?|projects?|roles?)$/.test(low)) { kind = low.replace(/s$/, '') + (low === 'facts' ? 's' : ''); used = 0; continue; }
    if (kind === 'facts' || (kind === 'fact' && used === 0)) { facts.push(Number(tok)); used++; continue; }
    if ((kind === 'project' || kind === 'role') && used === 0) { refused.push(`${kind}:${Number(tok)}`); used++; continue; }
    return null;
  }
  return { facts, refused };
}
// Marks that only wrapped a key ("({fact:1})", "**{fact:1}**", "`{fact:1}`") go with it.
const WRAPS: [string, string][] = [['**', '**'], ['__', '__'], ['(', ')'], ['[', ']'], ['*', '*'], ['_', '_'], ['`', '`'], ['"', '"'], ["'", "'"], ['“', '”']];
// A word or mark that only led in to a key ("see", "source:", "from", a dash, a semicolon), when nothing follows the key.
const LEAD_WORD = /([\s([]|^)(?:see|sources?|from|cf\.?|via)[^\S\n]*:?$/i, LEAD_MARK = /(\S)[^\S\n]*[—–;-]$/;
// The line with the text from `at` to `end` taken out, and what is left joined as plain prose: no doubled full stop, no
// space before a full stop, one space between words, and no wrapper or lead-in that only served the key.
function cut(line: string, at: number, end: number): string {
  const trimL = (x: string) => x.replace(/[^\S\n]+$/, ''), trimR = (x: string) => x.replace(/^[^\S\n]+/, '');
  let left = trimL(line.slice(0, at)), right = trimR(line.slice(end));
  for (let again = true; again;) {
    again = false;
    for (const [o, c] of WRAPS) if (left.endsWith(o) && right.startsWith(c)) { left = trimL(left.slice(0, -o.length)); right = trimR(right.slice(c.length)); again = true; break; }
    if (!again && (right === '' || /^[)\]}.,;:!?]/.test(right))) {
      const lead = left.replace(LEAD_WORD, '$1').replace(LEAD_MARK, '$1');
      if (lead !== left) { left = trimL(lead); again = true; }
    }
  }
  if (right === '') return left;
  if (/^[.,;:!?)\]]/.test(right)) {
    // After a full stop, a stop or separator the key left behind goes: "Engineer. {fact:1}; more" reads "Engineer. more".
    if (/[.!?]$/.test(left) && /^[.,;:]/.test(right)) { right = trimR(right.slice(1)); return right === '' ? left : `${left} ${right}`; }
    return /[.,;:]$/.test(left) && left.endsWith(right[0]) ? left + right.slice(1) : left + right;
  }
  return left === '' || /\s$/.test(left) ? left + right : `${left} ${right}`;
}
// One line with its keys taken out, and the ids of the groups that could be read.
function takeLine(line: string): { text: string; facts: number[]; refused: string[] } {
  const facts: number[] = [], refused: string[] = [];
  let text = line;
  for (let found = true; found;) {
    found = false;
    for (const m of text.matchAll(GROUP)) {
      if (!isKey(m[2], m[1])) continue;
      const r = readKey(m[2]);
      if (r) { facts.push(...r.facts); refused.push(...r.refused); }
      text = cut(text, m.index!, m.index! + m[0].length);
      found = true;
      break;
    }
  }
  // A group left open at the end of the line, when nothing but key text follows its bracket.
  const t = TAIL.exec(text);
  if (t && isKey(t[2], t[1])) { const r = readKey(t[2]); if (r) { facts.push(...r.facts); refused.push(...r.refused); } text = cut(text, t.index, text.length); }
  return { text: text === line ? line : text.replace(/[^\S\n]+$/, ''), facts: [...new Set(facts)], refused: [...new Set(refused)] };
}
const MAYBE = /fact|F-\d{4}|project|role/i;
// A key still printed in a text: a bracketed group of key text (the same reading as above), or, outside brackets, the
// exact key "fact:12". Prose such as "the facts: 12 services", "fact #3" or "ISO F-0012 form" is no key. null for none.
export function keyMark(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!MAYBE.test(line)) continue;
    for (const m of line.matchAll(GROUP)) if (isKey(m[2], m[1])) return m[0];
    const t = TAIL.exec(line);
    if (t && isKey(t[2], t[1])) return t[0];
    const bare = /\bfact:\d+\b/i.exec(line);
    if (bare) return bare[0];
    // A reference alone in brackets of any kind, or after a lead-in word ("(F-0001)", "<F-0001>", "{ref F-0001}"): named,
    // not taken out by itself, since a form's name in prose may look the same. "(Form F-1065)" is no key.
    for (const m of line.matchAll(GROUP)) if (REF_ONLY.test(m[2])) return m[0];
  }
  return null;
}
const REF_ONLY = /^[\s"'`*]*(?:(?:ref|see|source|fact)\b[\s:.#]*)?F-\d{4,}[\s"'`*.]*$/i;

export const keyOf = (l: { where: Where; entry: string; text: string }) => `${l.where}\u0000${l.where === 'summary' ? '' : l.entry}\u0000${l.text}`;

// The lines that can carry a link, in the order of the page. `companies` are the employers' names as the bank has them
// (parseResume parts a heading with them); every caller passes the same, so an entry is named the same everywhere.
export function places(markdown: string, companies: string[] = []): { places: Place[]; summary: number[] } {
  const r = parseResume(markdown, companies), lines = lf(markdown).split('\n'), out: Place[] = [];
  const bulletLines = new Set(r.outline.filter((o) => o.kind === 'bullet').map((o) => o.line));
  const first = r.outline.find((o) => o.kind === 'summary');
  let summary: number[] = [];
  if (first) {
    const next = r.outline.find((o) => o.line > first.line)?.line ?? lines.length;
    summary = lines.map((l, i) => i).filter((i) => i >= first.line && i < next && lines[i].trim() !== '' && !/^#/.test(lines[i].trim()));
    out.push({ where: 'summary', entry: '', text: r.summary, line: summary[summary.length - 1], n: -1 });
  }
  r.experience.forEach((e, n) => {
    const at = e.at.lines.filter((i) => bulletLines.has(i));
    e.bullets.forEach((text, k) => { if (at[k] !== undefined) out.push({ where: 'bullet', entry: normCompany(e.company || e.title), text, line: at[k], n }); });
  });
  return { places: out.sort((a, b) => a.line - b.line), summary };
}

// Takes every key out of a text a model wrote (with links on: lib/jobs.ts, tidy). A line with none is left exactly as
// it was, so a text with no key comes back unchanged. The keys of a bullet, and of the Summary's lines together, are its
// cites; a key anywhere else (a heading, the dates, Skills) is taken out and not kept.
export function takeLinks(markdown: string, companies: string[] = []): { clean: string; cites: Cite[] } {
  const lines = markdown.split('\n'), keys = new Map<number, { facts: number[]; refused: string[] }>();
  const clean = lines.map((l, i) => {
    if (!MAYBE.test(l)) return l;
    const r = takeLine(l);
    if (r.facts.length || r.refused.length) keys.set(i, r);
    return r.text;
  }).join('\n');
  if (keys.size === 0) return { clean, cites: [] };
  const { places: ps, summary } = places(clean, companies), cites: Cite[] = [];
  for (const p of ps) {
    const ks = (p.where === 'summary' ? summary : [p.line]).map((i) => keys.get(i)).filter((k) => k !== undefined);
    const facts = [...new Set(ks.flatMap((k) => k.facts))], refused = [...new Set(ks.flatMap((k) => k.refused))];
    if (facts.length || refused.length) cites.push({ where: p.where, text: p.text, facts, refused });
  }
  return { clean, cites };
}

// The text with every key taken out, for a reader who must never see one. A text with no key comes back unchanged, and
// with EGG_LINKS=off nothing is taken out at all, so every prompt is what it was before links.
export const stripLinks = (text: string) => (linksOn() && MAYBE.test(text) ? text.split('\n').map((l) => (MAYBE.test(l) ? takeLine(l).text : l)).join('\n') : text);

// The links of a text as code left it (lib/jobs.ts, tidy): each line takes the keys the model gave it, matched by where
// it is and its words, in order. A line the model gave no key keeps the link of the same words in the same entry from
// an earlier version of this writing (`pool`): the same words make the same claim. Any other line has no link.
export function linkLines(markdown: string, cites: Cite[], companies: string[] = [], pool?: Map<string, LinkLine>): Links {
  const used = new Set<number>(), lines: LinkLine[] = [];
  for (const p of places(markdown, companies).places) {
    const i = cites.findIndex((c, k) => !used.has(k) && c.where === p.where && c.text === p.text);
    if (i >= 0) {
      used.add(i);
      const c = cites[i];
      lines.push({ where: p.where, entry: p.entry, text: p.text, facts: c.facts, edited: 0, ...(c.refused.length ? { refused: c.refused } : {}) });
      continue;
    }
    const before = pool?.get(keyOf(p));
    if (before) lines.push({ ...before, entry: p.entry, text: p.text });
  }
  return { v: 1, lines };
}

// What `jobs.links` holds, read; null for '' (written before links) or anything that cannot be read.
// Every line must have the shape this version writes; anything else (another version, a line that is not an object, facts
// that are not a list of numbers) is read as no links at all, never as part of them, and never throws.
const lineOk = (l: unknown): l is LinkLine => {
  if (!l || typeof l !== 'object') return false;
  const x = l as Record<string, unknown>;
  return (x.where === 'summary' || x.where === 'bullet') && typeof x.entry === 'string' && typeof x.text === 'string' && typeof x.edited === 'number'
    && Array.isArray(x.facts) && x.facts.every((f) => Number.isInteger(f)) && (x.refused === undefined || (Array.isArray(x.refused) && x.refused.every((r) => typeof r === 'string')));
};
export function parseLinks(stored: string | null | undefined): Links | null {
  if (!stored) return null;
  try { const l = JSON.parse(stored) as Links; return l && l.v === 1 && Array.isArray(l.lines) && l.lines.every(lineOk) ? l : null; } catch { return null; }
}
export const storeLinks = (links: Links | null) => (links ? JSON.stringify(links) : '');

// Each line's link, found by where it is, its entry and its words; lines of the same words are taken in order.
// One lookup for every reader of links (the check, the resume screen): called once for each line in the order of the
// page, each line takes the next link of its words, so two lines of the same words each keep their own.
export const linkFinder = (links: Links) => lookup(links);
function lookup(links: Links): (p: { where: Where; entry: string; text: string }) => LinkLine | undefined {
  const byKey = new Map<string, LinkLine[]>();
  for (const l of links.lines) { const k = keyOf(l); byKey.set(k, [...(byKey.get(k) ?? []), l]); }
  return (p) => byKey.get(keyOf(p))?.shift();
}

// The text with each line's keys put back at its end, for a model that rewrites it (the council's reviser, the skim's
// fix): it then sees what each line cites and keeps or changes the keys with the line. A text with no links comes back as it is.
export function annotate(clean: string, links: Links | null, companies: string[] = []): string {
  if (!links || links.lines.length === 0) return clean;
  const lines = clean.split('\n'), find = lookup(links);
  for (const p of places(clean, companies).places) {
    const l = find(p), keys = l ? [...l.facts.map((f) => `fact:${f}`), ...(l.refused ?? [])] : [];
    if (keys.length) lines[p.line] = `${lines[p.line].replace(/\s+$/, '')} {${keys.join(', ')}}`;
  }
  return lines.join('\n');
}

// Line-by-line differences of two lists, as runs: the old lines taken out and the new lines put in at one place.
type Run = { from: number[]; to: number[] };
function runs(a: string[], b: string[]): { same: [number, number][]; runs: Run[] } {
  const n = a.length, m = b.length, t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const same: [number, number][] = [], out: Run[] = [];
  let i = 0, j = 0, cur: Run = { from: [], to: [] };
  const close = () => { if (cur.from.length || cur.to.length) out.push(cur); cur = { from: [], to: [] }; };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { close(); same.push([i, j]); i++; j++; }
    else if (j < m && (i >= n || t[i][j + 1] >= t[i + 1][j])) cur.to.push(j++);
    else cur.from.push(i++);
  }
  close();
  return { same, runs: out };
}

// How many lines an edit changed: for each run of change, the larger of the lines taken out and the lines put in.
export function changedLines(before: string, after: string): number {
  const a = lf(before).split('\n').filter((l) => l.trim() !== ''), b = lf(after).split('\n').filter((l) => l.trim() !== '');
  return runs(a, b).runs.reduce((s, r) => s + Math.max(r.from.length, r.to.length), 0);
}

// Whether a line put in the place of another is plainly the same line reworded: they share at least half of their
// content words (words of four letters or more, case, punctuation and a plural "s" aside), or a number and at least a
// quarter of them. Counted against the longer line. When in doubt it is not: a missing link is honest, a wrong one is not.
const contentWords = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\s]+/gu, ' ').split(/\s+/).filter((w) => w.length >= 4).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)));
const numbersIn = (t: string) => new Set((t.match(/\d[\d,.]*\d|\d/g) ?? []).map((x) => x.replace(/,/g, '')));
export function reworded(a: string, b: string): boolean {
  const wa = contentWords(a), wb = contentWords(b), most = Math.max(wa.size, wb.size);
  if (most === 0) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length, nb = numbersIn(b);
  return shared * 2 >= most || ([...numbersIn(a)].some((x) => nb.has(x)) && shared * 4 >= most);
}
// How close two lines are, by the same word measure: the content words they share, over the longer line's.
export function closeness(a: string, b: string): number {
  const wa = contentWords(a), wb = contentWords(b), most = Math.max(wa.size, wb.size);
  return most === 0 ? 0 : [...wa].filter((w) => wb.has(w)).length / most;
}

// Which Experience entry of the text after an edit is which entry before it: the same employer (the group of the record
// that parseResume's heading resolves to, with `roles`; else the employer's name), else the entry at the same place
// whose employer is no longer on the page. So an employer's name edited on its heading keeps its bullets' links.
function sameEntries(before: string, after: string, companies: string[], roles?: RoleRow[]): Map<number, number> {
  const groups = roles ? employers(roles) : [];
  const ids = (md: string) => parseResume(md, companies).experience.map((e) => {
    const g = roles ? groupOf(e.title, e.company, [...e.ranges, ...e.previously.flatMap((p) => p.ranges)], groups).group : undefined;
    return g ? `g:${g.key}` : `c:${normCompany(e.company || e.title)}`;
  });
  const was = ids(before), now = ids(after), out = new Map<number, number>(), taken = new Set<number>();
  now.forEach((id, i) => { const j = was.findIndex((w, k) => w === id && !taken.has(k)); if (j >= 0) { out.set(i, j); taken.add(j); } });
  now.forEach((_id, i) => { if (!out.has(i) && i < was.length && !taken.has(i) && !now.includes(was[i])) { out.set(i, i); taken.add(i); } });
  return out;
}

// The links of the owner's edit (decision 2 of the owner, 18 Nov 2026), place by place in each entry and the Summary:
// - a line whose words are unchanged in the same entry keeps its link as it was (also when it moved within the entry);
// - a line replaced in place (in a run of change, exactly one line out and one in) that is plainly the same line
//   reworded (`reworded`), and closer to that old line than to any other old line of its entry (`closeness`), keeps the
//   old line's facts, with `edited` set to `now`; its numbers are still checked;
// - any other new line (added, put in another line's place, moved in from another entry, or two merged into one) gets
//   no facts, with `edited` set to `now`: the owner wrote it.
// An entry is the same entry by its employer, or by its place when its employer's name was edited (`sameEntries`).
// A resume written before links (null) stays without them.
export function carry(before: string, after: string, links: Links | null, companies: string[] = [], now = Date.now(), roles?: RoleRow[]): Links | null {
  if (!links) return null;
  const find = lookup(links), was = places(before, companies).places.map((p) => ({ ...p, link: find(p) })), next = places(after, companies).places;
  const map = sameEntries(before, after, companies, roles);
  const groupOld = (p: Place) => (p.where === 'summary' ? 's' : `b:${p.n}`), groupNew = (p: Place) => (p.where === 'summary' ? 's' : map.has(p.n) ? `b:${map.get(p.n)}` : `new:${p.n}`);
  const out: LinkLine[] = [];
  for (const g of [...new Set(next.map(groupNew))]) {
    const olds = was.filter((p) => groupOld(p) === g), news = next.filter((p) => groupNew(p) === g);
    // null: the line stays as the model left it, with no link.
    const d = runs(olds.map((p) => p.text), news.map((p) => p.text)), got = new Map<number, LinkLine | null>(), taken = new Set<number>();
    for (const [i, j] of d.same) { const l = olds[i].link; taken.add(i); got.set(j, l ? { ...l, entry: news[j].entry, text: news[j].text } : null); }
    for (const r of d.runs) {
      // The old line at its place must be plainly the same line reworded, and the single closest of the entry's old lines
      // (those that stayed, moved or went): if another is as close, which line it came from is a guess, and it has no link.
      const o = r.from[0], t = news[r.to[0]]?.text ?? '', near = closeness(olds[o]?.text ?? '', t);
      if (r.from.length === 1 && r.to.length === 1 && reworded(olds[o].text, t) && olds.every((x, i) => i === o || closeness(x.text, t) < near)) {
        const l = olds[r.from[0]].link;
        taken.add(r.from[0]);
        got.set(r.to[0], { where: news[r.to[0]].where, entry: news[r.to[0]].entry, text: news[r.to[0]].text, facts: l?.facts ?? [], edited: now, ...(l?.refused?.length ? { refused: l.refused } : {}) });
      }
    }
    news.forEach((p, j) => {
      if (got.has(j)) return;
      // The same words, moved within the entry: the same claim, so the same link.
      const k = olds.findIndex((o, i) => !taken.has(i) && o.text === p.text);
      if (k >= 0) { taken.add(k); const l = olds[k].link; got.set(j, l ? { ...l, entry: p.entry, text: p.text } : null); return; }
      got.set(j, { where: p.where, entry: p.entry, text: p.text, facts: [], edited: now });
    });
    news.forEach((_p, j) => { const l = got.get(j); if (l) out.push(l); });
  }
  return { v: 1, lines: out };
}

// ---------- The check ----------

export type CitedFact = { id: number; role_id: number | null; text: string; detail: string; metric: string; baseline: string; team: string; own_part: string; skills: string };
// data: what the finding is about, for a screen that words it for the owner (lib/resumeview.ts): the numbers in none of
// the cited facts, the facts concerned, and for a fact of another job the employer it belongs to ('' for no job).
export type LinkFinding = { kind: 'link-unknown' | 'link-elsewhere' | 'link-number' | 'unlinked'; severity: 'high' | 'warn' | 'info'; text: string; place: Place;
  data?: { numbers?: string[]; facts?: number[]; under?: string[]; refused?: string[] } };
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const short = (s: string, most = 90) => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s);

// The four findings of a resume's links, against the facts as they are now (a fact edited or deleted since the line was
// written gives a true finding). `linked` holds the lines that cite at least one fact that exists and belongs to their
// entry: for those, the number check here takes the place of the employer-wide context check (lib/checks.ts). For a
// resume with no links (null) nothing is found and every line is checked as before.
// - link-unknown: a key names no fact in the record (deleted, or never one), or is no fact's key.
// - link-elsewhere: a bullet cites a fact of another employer, or of no employer.
// - link-number: a number of the line is in none of the facts it cites (their text, story, metric, number before, team,
//   own part and skills), by value. Years are left to the role dates.
// - unlinked: a line with no fact left to stand behind it. On a line the owner wrote it is only for information.
export function checkLinks(markdown: string, links: Links | null, data: { facts: CitedFact[]; roles: RoleRow[]; versions?: string[] }): { findings: LinkFinding[]; linked: Set<string> } {
  const findings: LinkFinding[] = [], linked = new Set<string>();
  if (!links) return { findings, linked };
  const companies = data.roles.map((r) => r.company), groups = employers(data.roles), byId = new Map(data.facts.map((f) => [f.id, f]));
  const groupOf = (entry: string) => groups.find((g) => g.rows.some((r) => normCompany(r.company) === entry));
  const employerOf = (roleId: number | null) => (roleId === null ? undefined : groups.find((g) => [...g.rows, ...g.children].some((r) => r.id === roleId)));
  const find = lookup(links);
  for (const p of places(markdown, companies).places) {
    const l = find(p), label = p.where === 'summary' ? 'The summary' : `“${p.text}”`;
    const say = (kind: LinkFinding['kind'], severity: LinkFinding['severity'], text: string, data?: LinkFinding['data']) => findings.push({ kind, severity, text, place: p, ...(data ? { data } : {}) });
    if (!l || (l.facts.length === 0 && !(l.refused ?? []).length)) {
      if (l && l.edited > 0) say('unlinked', 'info', `${p.where === 'summary' ? 'You wrote the summary' : `You wrote “${p.text}”`}, so no fact of your record is linked to it.`);
      else say('unlinked', 'warn', `${label} names no fact of your record that it draws on.`);
      continue;
    }
    const gone = l.facts.filter((id) => !byId.has(id)), refused = l.refused ?? [];
    if (gone.length) say('link-unknown', 'high', `${label} cites ${andList(gone.map((id) => factRef(id)))}, which ${gone.length === 1 ? 'is' : 'are'} no longer in your record. A link is never moved to another fact: cite one your record has.`, { facts: gone });
    if (refused.length) say('link-unknown', 'high', `${label} cites ${andList(refused)}, which ${refused.length === 1 ? 'is' : 'are'} not a fact. Only a fact of your record stands behind a line.`, { refused });
    let valid = l.facts.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const g = p.where === 'bullet' ? groupOf(p.entry) : undefined;
    if (g) {
      const ids = new Set([...g.rows, ...g.children].map((r) => r.id)), away = valid.filter((f) => f.role_id === null || !ids.has(f.role_id));
      if (away.length) {
        const where = [...new Set(away.map((f) => employerOf(f.role_id)?.company ?? 'no job'))];
        say('link-elsewhere', 'high', `${label} cites ${andList(away.map((f) => factRef(f.id)))}, which your record has under ${andList(where)}, not under ${g.company}. A line cites only facts of its own job.`,
          { facts: away.map((f) => f.id), under: away.map((f) => employerOf(f.role_id)?.company ?? '') });
        valid = valid.filter((f) => !away.includes(f));
      }
    }
    if (valid.length === 0) { say('unlinked', 'warn', `${label} has no fact left that stands behind it.`); continue; }
    linked.add(keyOf(p));
    const stated = valid.map((f) => [f.text, f.detail, f.metric, f.baseline, f.team, f.own_part, f.skills].join(' ')).join(' ');
    const off = [...new Set(unheld(p.text, stated, { versions: data.versions }).map((x) => x.text))];
    if (off.length) {
      const says = valid.slice(0, 2).map((f) => `${factRef(f.id)} says “${short(f.text)}${f.metric ? ` (${f.metric})` : ''}”.`).join(' ');
      say('link-number', 'high', `${label} uses ${andList(off)}, which ${off.length === 1 ? 'is' : 'are'} in none of the facts it cites. ${says}${l.edited > 0 ? ' Those facts were linked before you edited the line.' : ''} Take ${off.length === 1 ? 'it' : 'them'} out, or cite the fact that states ${off.length === 1 ? 'it' : 'them'}.`, { numbers: off, facts: valid.slice(0, 2).map((f) => f.id) });
    }
  }
  return { findings, linked };
}
