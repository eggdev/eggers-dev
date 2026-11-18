// A resume checked by rule, with no model: every point traces to a line below. Adapted from the
// "ATS Validator Architect" agent (github.com/msitarzewski/agency-agents): its bullet formula
// (what was done 25%, a measured result 45%, the method or tool 30%, less penalties), its guards
// against counting a version number as a result, its word budget, and its four weighted parts.
//
// One thing is not taken from it: a bullet is never asked to carry a number. This app's rule is
// that a number is never made up and an incidental one stays out (lib/writing.ts), so the share of bullets
// with a measured result is reported and scored, but only the penalties are handed to the reviser.
//
// Tense follows the role (RESUME-RULES.md, rule 11): a bullet under the current role opens in the present
// tense, one under a past role in the past tense. The resume is read with the one parser (lib/resume.ts).
import { parseResume } from './resume.ts';

export type Flag = { quote: string; why: string; fix: string };
export type Part = { label: string; weight: number; score: number };
export type Bullets = { count: number; measured: number; score: number; flags: Flag[] };

// A number that is a version, a port, a status code or a standard says nothing about a result.
const NOT_RESULTS = [/\b(?:Python|Java|Angular|Node(?:\.js)?|React|Vue|Go|Ruby|PHP|Swift|ES|v)\s*\d+(?:\.\d+)*/gi, /\b(?:Port\s*\d{2,5}|HTTP\s*[1-5]\d{2}|IPv[46]|HTTP\/[123])\b/gi, /\b(?:ISO\s*\d{4,5}|SOC\s*[123]|RFC\s*\d{3,5}|WCAG\s*\d(?:\.\d)?|OAuth\s*\d)\b/gi];
const COUNTED = /\d|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?|millions?|billions?|half|double[ds]?|tripled?)\b/i;
const OUTCOME = /\b(?:zero\s+(?:downtime|data\s+loss|incidents?)|first-ever|from\s+scratch|patent\s+granted|acquired by)\b/i;
const DUTY = /^(?:responsible for|assist(?:s|ed)? (?:in|with)|help(?:s|ed)? (?:to|with)\b|work(?:s|ed)? (?:on|with)|participate[sd]? in|tasked with|duties included?|involved in|serve[sd]? as|act(?:s|ed)? as|technical lead (?:for|on|of)|tech lead (?:for|on|of))/i;
const VERBS = new Set(['built', 'led', 'won', 'wrote', 'ran', 'cut', 'drove', 'grew', 'made', 'took', 'set', 'rebuilt', 'taught', 'sold', 'brought', 'kept', 'found', 'gave', 'began', 'chose', 'held', 'put', 'sent', 'got', 'did', 'rewrote', 'oversaw', 'spoke', 'stood']);
const METHOD = /\b(?:by|with|using|through|in|on|from)\s+[A-Z][\w.+#-]+|\bso (?:that\s)?\w+/;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
// "As sole engineer, shipped Ledgerly…" leads with "shipped".
const lead = (b: string) => (/^(?:As|While|With|After|In|On)\b[^,]{0,40},\s*([\w-]+)/.exec(b)?.[1] ?? words(b)[0] ?? '').toLowerCase().replace(/[.,:;]+$/, '');
// Present-tense openers, for the current role. A word outside this list still counts when it reads as one (see present).
export const PRESENT = new Set(['build', 'lead', 'win', 'write', 'run', 'drive', 'grow', 'make', 'take', 'rebuild', 'teach', 'sell', 'bring', 'keep', 'find', 'give', 'begin', 'choose', 'hold', 'send', 'get', 'do', 'rewrite', 'oversee', 'speak', 'stand',
  'manage', 'design', 'develop', 'maintain', 'own', 'ship', 'create', 'support', 'train', 'coach', 'mentor', 'deliver', 'implement', 'architect', 'operate', 'partner', 'define', 'automate', 'deploy', 'migrate', 'test', 'review', 'plan', 'coordinate', 'direct', 'guide', 'analyze', 'improve', 'reduce', 'launch', 'integrate', 'scale', 'advise', 'serve', 'handle', 'prototype', 'help', 'work', 'turn', 'move', 'replace', 'add', 'set up']);
// Verbs that read the same in both tenses.
const EITHER = new Set(['cut', 'set', 'put', 'read', 'hit', 'let', 'shut', 'spread', 'split', 'quit', 'cast']);
const NOT_VERBS = new Set(['the', 'a', 'an', 'as', 'in', 'on', 'for', 'with', 'to', 'of', 'at', 'by', 'responsible', 'technical', 'tech', 'senior', 'sole', 'primary', 'key', 'main', 'member', 'part', 'various', 'multiple', 'several']);
// "Tech-led" and "co-founded" are verbs too: the last part of a hyphenated opener decides.
const last = (verb: string) => verb.split('-').pop() ?? verb;
const past = (verb: string) => VERBS.has(verb) || VERBS.has(last(verb)) || /\w{2,}ed$/.test(last(verb));
const base = (verb: string) => PRESENT.has(verb) || PRESENT.has(last(verb)) || PRESENT.has(last(verb).replace(/s$/, ''));
const present = (verb: string) => EITHER.has(last(verb)) || base(verb) || (/^[a-z]+$/.test(last(verb)) && !past(verb) && !/ing$/.test(last(verb)) && !NOT_VERBS.has(last(verb)));
// Whether a bullet opens with an action in the tense its role calls for.
const acted = (verb: string, current: boolean) => (current ? present(verb) : past(verb));
// A bullet in the wrong tense for its role: past under the current role, or a known present-tense verb under a past one.
const slip = (verb: string, current: boolean) => !EITHER.has(last(verb)) && (current ? past(verb) : !past(verb) && base(verb));

// The bullets of Experience (and of Projects, in a resume written before that section was dropped), in order,
// each with the role it sits under and whether that role is current.
export function bulletsOf(markdown: string): { role: string; text: string; current: boolean }[] {
  const r = parseResume(markdown);
  return [...r.experience, ...r.projects].flatMap((e) => e.bullets.map((text) => ({ role: e.heading, text, current: e.current })));
}

// Each bullet: (25 for an action verb in its role's tense + 45 for a measured result + 30 for a named method or
// tool) less 40 for a duty statement, 25 for running past 35 words, 15 for a third bullet in a row on one verb.
// Each bullet that opens in the wrong tense for its role (as `bullets` flags it), with the heading of its entry, so the
// flag is placed on that bullet only (lib/checks.ts) and never on the same words under a role where the tense is right.
export const wrongTense = (markdown: string): { role: string; text: string; current: boolean }[] =>
  bulletsOf(markdown).filter((b) => !DUTY.test(b.text) && slip(lead(b.text), b.current)).map((b) => ({ role: b.role, text: b.text, current: b.current }));
// Whether a bullet opens as a duty ("Responsible for", "Worked on"…), as the skim reads it.
export const opensAsDuty = (text: string) => DUTY.test(text);

export function bullets(markdown: string, terms: string[] = []): Bullets {
  const all = bulletsOf(markdown), flags: Flag[] = [];
  // Whole words only, so "go" is not found in "going".
  const named = terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 1).map((t) => new RegExp(`(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`));
  let total = 0, measured = 0;
  all.forEach((b, i) => {
    const verb = lead(b.text), n = words(b.text).length;
    const bare = NOT_RESULTS.reduce((s, re) => s.replace(re, ' '), b.text);
    const duty = DUTY.test(b.text), result = COUNTED.test(bare) || OUTCOME.test(b.text);
    const low = b.text.toLowerCase(), method = METHOD.test(b.text) || named.some((t) => t.test(low));
    const run = i >= 2 && all[i - 1].role === b.role && all[i - 2].role === b.role && lead(all[i - 1].text) === verb && lead(all[i - 2].text) === verb;
    let penalty = 0;
    if (duty) { penalty += 40; flags.push({ quote: b.text, why: 'It opens as a duty, not as something done.', fix: `Open with what the person ${b.current ? 'does, as a present-tense verb' : 'did, as a past-tense verb'}.` }); }
    else if (slip(verb, b.current)) flags.push({ quote: b.text, why: b.current ? 'It opens in the past tense, and this role is current.' : 'It opens in the present tense, and this role has ended.', fix: b.current ? 'Open it in the present tense (“Build”, “Lead”).' : 'Open it in the past tense (“Built”, “Led”).' });
    if (n > 35) { penalty += 25; flags.push({ quote: b.text, why: `It runs to ${n} words, past what a skim takes in.`, fix: 'Cut it to under 30 words, or split it if it says two things.' }); }
    if (run) { penalty += 15; flags.push({ quote: b.text, why: `It is the third bullet in a row to open with “${verb}”.`, fix: 'Open it with a different verb that is still exact.' }); }
    if (result) measured++;
    total += Math.max(0, (!duty && acted(verb, b.current) ? 25 : 0) + (result ? 45 : 0) + (method ? 30 : 0) - penalty);
  });
  return { count: all.length, measured, score: all.length ? Math.round(total / all.length) : 0, flags };
}

// One page holds 350 to 650 words, two hold 650 to 1,100. Past either edge the score falls a point every three words.
export function density(wordCount: number, pages: number): { score: number; low: number; high: number } {
  const [low, high] = pages === 1 ? [350, 650] : [650, 1100];
  const off = wordCount < low ? low - wordCount : wordCount > high ? wordCount - high : 0;
  return { score: Math.max(0, Math.round(100 - off / 3)), low, high };
}

// Characters a parser cannot index: glyphs with no Unicode meaning (private use) and the replacement mark.
export const unreadable = (text: string) => (text.match(/[-�]/g) ?? []).length;

export const WEIGHTS = { terms: 40, bullets: 30, structure: 15, density: 15 };
export const overall = (parts: Part[]) => Math.round(parts.reduce((sum, p) => sum + (p.score * p.weight) / 100, 0));

// A resume is ready to send at 85 of 100. The terms part counts the posting's terms the bank supports:
// one the bank cannot support is never added, so it lowers the job's fit and not this score.
export const REQUIRED = 85;

// The same score taken from the Markdown alone, before a PDF exists, so the writer can be held to it.
// Structure is taken as sound: the PDF check settles that part once the file is printed.
export function draftScore(markdown: string, supported: string[], pages: number, tools: string[] = []): { score: number; parts: Part[]; notes: string[] } {
  const low = markdown.toLowerCase(), left = supported.filter((t) => !low.includes(t.toLowerCase()));
  const b = bullets(markdown, [...supported, ...tools]), count = markdown.replace(/[#*_`>|]/g, ' ').split(/\s+/).filter(Boolean).length, room = density(count, pages);
  const parts: Part[] = [
    { label: 'Supported terms', weight: WEIGHTS.terms, score: supported.length ? Math.round(((supported.length - left.length) / supported.length) * 100) : 100 },
    { label: 'Bullets', weight: WEIGHTS.bullets, score: b.score },
    { label: 'Structure', weight: WEIGHTS.structure, score: 100 },
    { label: 'Word count', weight: WEIGHTS.density, score: room.score },
  ];
  const notes: string[] = [];
  if (left.length) notes.push(`These terms from the posting are supported by the bank and missing from the resume: ${left.join(', ')}. Work each into the bullet whose work used it, beside its evidence. Never add them as a list.`);
  if (room.score < 100) notes.push(`It runs to about ${count} words. ${pages === 1 ? 'One page' : 'Two pages'} read well between ${room.low} and ${room.high}: ${count < room.low ? 'add stronger work from the bank' : 'cut the weakest bullets'}.`);
  if (b.score < 70) notes.push(`${b.count - b.measured} of ${b.count} bullets state no measured result. Where the bank holds a result or a number worth showing for that same work, show it, and name the tool or method where the bank names one. Where it holds none, leave the bullet as it is: never invent one.`);
  return { score: overall(parts), parts, notes };
}
