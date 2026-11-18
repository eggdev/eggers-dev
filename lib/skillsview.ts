// The Skills screen's list (GET /skills, POST /skills in server.ts): the skills list of rule 7 (lib/skills.ts) as the
// owner reviews it. No model is asked anywhere here.
// - The list in groups: skills new since the last review first (only once there was one), then by kind. Each skill
//   with how many facts name it, in how many roles (from where each fact sits in the record, lib/tree.ts), the facts
//   themselves, its mark, and whether a question about it waits on Home. A skill no fact names any more is set aside
//   by syncSkills and is not listed.
// - A mark from the list: where Home holds an open question about that skill, the mark is that question's answer,
//   given through the same path an answer on Home takes (lib/raised.ts, answer), so the two always agree. Every other
//   mark, and the review, go through markSkills, which writes only what changes.
import { db } from './db.ts';
import { answer, openRaised } from './raised.ts';
import { allSkills, markSkills, reviewedOn, type Skill } from './skills.ts';
import { factRef, placeOf, type ProjectRow, type TreeRoleRow } from './tree.ts';

export type SkillFact = { id: string; ref: string; text: string };
export type SkillView = { key: string; id: string; name: string; kind: string; mark: string; facts: number; roles: number; isNew: boolean; question: boolean; factList: SkillFact[] };
export type SkillGroup = { id: string; title: string; skills: SkillView[] };
export type SkillsView = { reviewed: boolean; reviewedAt: number; reviewedOn: string; newCount: number; groups: SkillGroup[] };

const TITLES: Record<string, string> = { new: 'New since your last review', tool: 'Tools', language: 'Languages', platform: 'Platforms', other: 'Not a tool, language or platform: never on a resume' };
// In the server's own time zone, as the other dates the screens show (lib/record.ts).
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function skillsView(): SkillsView {
  const at = reviewedOn(), list = allSkills();
  const rows = db.query('SELECT * FROM roles').all() as TreeRoleRow[], projects = db.query('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  const facts = db.query('SELECT id, role_id, project_id, text, skills FROM facts ORDER BY id').all() as { id: number; role_id: number | null; project_id: number | null; text: string; skills: string }[];
  // For each skill (by its key, as syncSkills keys it), the facts that name it and the roles they sit in.
  const named = new Map<string, { facts: SkillFact[]; roles: Set<number> }>();
  for (const f of facts) {
    const role = placeOf(f, rows, projects).role;
    for (const key of new Set(f.skills.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))) {
      const n = named.get(key) ?? { facts: [], roles: new Set<number>() };
      n.facts.push({ id: String(f.id), ref: factRef(f.id), text: f.text });
      if (role !== null) n.roles.add(role);
      named.set(key, n);
    }
  }
  const asking = new Set(openRaised().filter((q) => q.kind === 'skill').map((q) => String(q.data.skill ?? '')));
  // A plain id for each skill, for the screen's test ids: its key in letters and digits, made unique.
  const ids = new Map<string, string>(), taken = new Set<string>();
  for (const s of list) { const base = s.key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill'; let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`; taken.add(id); ids.set(s.key, id); }
  const view = (s: Skill): SkillView => ({ key: s.key, id: ids.get(s.key)!, name: s.name, kind: s.kind, mark: s.mark, facts: s.facts, roles: named.get(s.key)?.roles.size ?? 0,
    isNew: at > 0 && s.added_at > at, question: asking.has(s.key), factList: named.get(s.key)?.facts ?? [] });
  const all = list.map(view), fresh = all.filter((s) => s.isNew);
  const groups: SkillGroup[] = [...(fresh.length ? [{ id: 'new', title: TITLES.new, skills: fresh }] : []),
    ...['tool', 'language', 'platform', 'other'].map((k) => ({ id: k, title: TITLES[k], skills: all.filter((s) => !s.isNew && s.kind === k) })).filter((g) => g.skills.length > 0)];
  return { reviewed: at > 0, reviewedAt: at, reviewedOn: at > 0 ? DAY.format(at) : '', newCount: fresh.length, groups };
}

// Marks from the list, and the review when `review` is true. "Not marked" is said on purpose, with its word
// ("unmarked"); an empty mark changes nothing, so a lost value can never clear a mark. A mark for a skill Home asks
// about is that question's answer, found by the words of its choice ("Yes, I am confident in it", "No, leave it off my
// resumes") and given through the answer's own path; a question whose words changed is refused in words. When the
// question is no longer open (Home answered it a moment before), the mark is set as any other. The answers and the
// marks are one transaction that takes the lock first: a refusal saves nothing. Entries that are not marks are skipped.
// Gives how many marks changed and how many marks and kinds changed, or the refusal in words.
export const CHOICE_WORDS: Record<string, string> = { confident: 'Yes, I am confident in it', 'not-confident': 'No, leave it off my resumes' };
type Refusal = { refused: string };
export function markFromList(entries: unknown[], review: boolean, now: number): { marked: number; changed: number; refused?: string } {
  const marks = (Array.isArray(entries) ? entries : []).filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m))
    .map((m) => ({ name: String(m.name ?? ''), mark: m.mark === 'unmarked' ? '' : typeof m.mark === 'string' && m.mark !== '' ? m.mark : undefined, kind: typeof m.kind === 'string' ? m.kind : undefined }));
  let out: { marked: number; changed: number } = { marked: 0, changed: 0 };
  try {
    db.transaction(() => {
      const open = new Map(openRaised().filter((q) => q.kind === 'skill').map((q) => [String(q.data.skill ?? ''), q]));
      let answered = 0;
      const rest = review ? marks : marks.filter((m) => {
        const q = open.get(m.name.trim().toLowerCase()), words = m.mark === undefined ? undefined : CHOICE_WORDS[m.mark];
        if (!q || !words || m.kind !== undefined) return true;
        const choice = q.choices.indexOf(words);
        if (choice < 0) throw { refused: `The question about ${m.name.trim()} on Home changed. Look at it again.` } satisfies Refusal;
        if (answer(q.key, choice, '', now, words) !== '') return true;
        answered++;
        return false;
      });
      const got = markSkills(rest, review, now);
      if (got.refused) throw { refused: got.refused } satisfies Refusal;
      out = { marked: got.marked + answered, changed: got.changed + answered };
    }).immediate();
  } catch (e) {
    if (e && typeof e === 'object' && 'refused' in e) return { marked: 0, changed: 0, refused: (e as Refusal).refused };
    throw e;
  }
  return out;
}
