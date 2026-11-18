// Rule 7, stage 3b: the two new openings code may suggest for a bullet of a resume the owner edited. No model writes
// words for an edited resume. Each changes only the opening words named below; the rest of the line stays byte for
// byte as the owner wrote it, and no word is added that the owner did not write.
// 1. The tense: a bullet the skim flags for the wrong tense (lib/ats.ts, wrongTense) gets its first word's ending
//    changed to the tense its job needs ("Lead" to "Led"; for a job held now, "Built" to "Build"). Only when the first
//    word is surely a verb: one of the verbs lib/ats.ts knows, or an irregular form in the table below.
// 2. A duty opener followed by the owner's own -ing verb: "Responsible for building X" becomes "Built X" (or "Build X"
//    for a job held now). Only the openers in OPENERS, and only when the very next word is an -ing form of a verb the
//    table knows. Not "Worked on", "Helped", "Assisted", "Involved in" or any other opener, and not "Responsible for the
//    billing run" (a noun follows): no suggestion, and the skim's flag stays.
// For both, the word right after the changed verb must open what the verb acts on: a determiner, a possessive or a
// number ("Lead the rebuild", "Responsible for training 4 new hires"). Otherwise the word may be a noun or an adjective
// ("Design system for…", "Responsible for building maintenance", "Managed services team"), or one verb of a list
// ("Responsible for designing and building…"), and there is no suggestion.
// This module only reads words. lib/suggest.ts makes, guards and stores the suggestions.
import { PRESENT } from './ats.ts';

// Each irregular verb lib/ats.ts knows, with its past form.
const IRREGULAR = new Map<string, string>([['lead', 'led'], ['build', 'built'], ['rebuild', 'rebuilt'], ['run', 'ran'], ['rerun', 'reran'], ['write', 'wrote'], ['rewrite', 'rewrote'],
  ['win', 'won'], ['drive', 'drove'], ['grow', 'grew'], ['make', 'made'], ['take', 'took'], ['teach', 'taught'], ['sell', 'sold'], ['bring', 'brought'], ['keep', 'kept'],
  ['find', 'found'], ['give', 'gave'], ['begin', 'began'], ['choose', 'chose'], ['hold', 'held'], ['send', 'sent'], ['get', 'got'], ['do', 'did'], ['oversee', 'oversaw'],
  ['speak', 'spoke'], ['stand', 'stood']]);
const PAST_OF_IRREGULAR = new Map([...IRREGULAR].map(([base, past]) => [past, base]));
// The verbs a suggestion may be made for: those lib/ats.ts reads as present-tense openers, and the irregular ones.
const KNOWN = new Set([...PRESENT].filter((v) => !v.includes(' ')).concat([...IRREGULAR.keys()]));
// Verbs whose last letter doubles before an ending ("ship", "shipped").
const DOUBLES = new Set(['ship', 'plan', 'run', 'win', 'begin', 'get']);

// A known verb's past form.
function pastOf(base: string): string {
  const irregular = IRREGULAR.get(base);
  if (irregular) return irregular;
  if (DOUBLES.has(base)) return `${base}${base.slice(-1)}ed`;
  if (base.endsWith('e')) return `${base}d`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ied`;
  return `${base}ed`;
}
// The known verb a word is a form of (the present, past or -ing form), or undefined when it is none the table knows.
function baseOf(word: string, form: 'present' | 'past' | 'ing'): string | undefined {
  const w = word.toLowerCase(), known = (x: string) => (x !== '' && KNOWN.has(x) ? x : undefined);
  if (form === 'present') return known(w) ?? (w.endsWith('s') ? known(w.slice(0, -1)) ?? (w.endsWith('es') ? known(w.slice(0, -2)) : undefined) : undefined);
  if (form === 'past') {
    const irregular = PAST_OF_IRREGULAR.get(w);
    if (irregular) return irregular;
    if (!w.endsWith('ed')) return undefined;
    const stem = w.slice(0, -2);
    // Only a base whose past form is exactly this word: "managed" is "manage", "shipped" is "ship", "added" is "add".
    return [stem.endsWith('i') ? `${stem.slice(0, -1)}y` : '', /(.)\1$/.test(stem) ? stem.slice(0, -1) : '', w.slice(0, -1), stem].map(known).find((x) => x !== undefined && pastOf(x) === w);
  }
  if (!w.endsWith('ing')) return undefined;
  const stem = w.slice(0, -3);
  return [/(.)\1$/.test(stem) && DOUBLES.has(stem.slice(0, -1)) ? stem.slice(0, -1) : '', stem, `${stem}e`].map(known).find((x) => x !== undefined);
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A new opening: the words taken off the front of the line, the word put there, and the rest of the line, unchanged.
export type Opening = { kind: 'tense' | 'verb'; from: string; to: string; rest: string; why: string };

// The words that open what a verb acts on, and a count: what must come right after the changed verb. "that" is not
// one of them: after a noun it starts a clause ("Design that cut drop-off…"). A number counts only as a whole count
// with a plural word within the next three words ("4 new hires", "6 engineers"), so a label or a version ("2.0 of
// the app", "24/7 on-call", "2 on the rota") opens nothing.
const OBJECT = /^\s+(?:(?:the|a|an|our|my|its|their|his|her|this|these|those|all|every|each|both)(?=\s)|\d[\d,]*(?=\s)(?:\s+[a-z][a-z-]*){0,2}\s+[a-z][a-z-]*s\b)/i;
// 1. The tense: the first word's ending changed to the tense the job needs. undefined when it is not surely a verb.
export function tenseOpening(text: string, current: boolean): Opening | undefined {
  const m = /^([A-Za-z]+)(?=\s)/.exec(text);
  if (!m) return undefined;
  const word = m[1], rest = text.slice(word.length);
  if (!OBJECT.test(rest)) return undefined;
  const base = baseOf(word, current ? 'past' : 'present');
  if (!base) return undefined;
  const to = /^[A-Z]/.test(word) ? cap(current ? base : pastOf(base)) : current ? base : pastOf(base);
  if (to === word) return undefined;
  return { kind: 'tense', from: word, to, rest, why: current ? 'Present tense for the job you hold now.' : 'Past tense for a job that has ended.' };
}

// The duty openers a suggestion may take off, in any case.
export const OPENERS = ['was responsible for', 'responsible for', 'tasked with', 'in charge of', 'duties included', 'duties include', 'charged with'];
const OPENER = new RegExp(`^(?:${OPENERS.map((o) => o.replace(/ /g, '\\s+')).join('|')})\\s+([A-Za-z]+ing)(?=[\\s,.;:]|$)`, 'i');
// 2. A duty opener and the owner's own -ing verb, as that verb in the tense the job needs. undefined otherwise.
export function dutyOpening(text: string, current: boolean): Opening | undefined {
  const m = OPENER.exec(text);
  if (!m || !OBJECT.test(text.slice(m[0].length))) return undefined;
  const base = baseOf(m[1], 'ing');
  if (!base) return undefined;
  const to = cap(current ? base : pastOf(base));
  return { kind: 'verb', from: m[0], to, rest: text.slice(m[0].length), why: `Opens with what you ${current ? 'do' : 'did'}: “${to}”, in place of “${m[0]}”.` };
}
// Whether a line opens with one of OPENERS (the rule a duty suggestion answers).
export const opensWithOpener = (text: string) => new RegExp(`^(?:${OPENERS.map((o) => o.replace(/ /g, '\\s+')).join('|')})\\b`, 'i').test(text);
