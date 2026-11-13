// A resume checked by rule, with no model: every point traces to a line below. Adapted from the
// "ATS Validator Architect" agent (github.com/msitarzewski/agency-agents): its bullet formula
// (what was done 25%, a measured result 45%, the method or tool 30%, less penalties), its guards
// against counting a version number as a result, its word budget, and its four weighted parts.
//
// One thing is not taken from it: a bullet is never asked to carry a number. This app's rule is
// that a number may always be left out and never made up (lib/writing.ts), so the share of bullets
// with a measured result is reported and scored, but only the penalties are handed to the reviser.

export type Flag = { quote: string; why: string; fix: string };
export type Part = { label: string; weight: number; score: number };
export type Bullets = { count: number; measured: number; score: number; flags: Flag[] };

// A number that is a version, a port, a status code or a standard says nothing about a result.
const NOT_RESULTS = [/\b(?:Python|Java|Angular|Node(?:\.js)?|React|Vue|Go|Ruby|PHP|Swift|ES|v)\s*\d+(?:\.\d+)*/gi, /\b(?:Port\s*\d{2,5}|HTTP\s*[1-5]\d{2}|IPv[46]|HTTP\/[123])\b/gi, /\b(?:ISO\s*\d{4,5}|SOC\s*[123]|RFC\s*\d{3,5}|WCAG\s*\d(?:\.\d)?|OAuth\s*\d)\b/gi];
const COUNTED = /\d|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?|millions?|billions?|half|double[ds]?|tripled?)\b/i;
const OUTCOME = /\b(?:zero\s+(?:downtime|data\s+loss|incidents?)|first-ever|from\s+scratch|patent\s+granted|acquired by)\b/i;
const DUTY = /^(?:responsible for|assisted (?:in|with)|helped (?:to|with)\b|worked (?:on|with)|participated in|tasked with|duties included|involved in|served as|acted as|technical lead (?:for|on|of)|tech lead (?:for|on|of))/i;
const VERBS = new Set(['built', 'led', 'won', 'wrote', 'ran', 'cut', 'drove', 'grew', 'made', 'took', 'set', 'rebuilt', 'taught', 'sold', 'brought', 'kept', 'found', 'gave', 'began', 'chose', 'held', 'put', 'sent', 'got', 'did', 'rewrote', 'oversaw', 'spoke', 'stood']);
const METHOD = /\b(?:by|with|using|through|in|on|from)\s+[A-Z][\w.+#-]+|\bso (?:that\s)?\w+/;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
// "As sole engineer, shipped Ledgerly…" leads with "shipped".
const lead = (b: string) => (/^(?:As|While|With|After|In|On)\b[^,]{0,40},\s*([\w-]+)/.exec(b)?.[1] ?? words(b)[0] ?? '').toLowerCase().replace(/[.,:;]+$/, '');
// "Tech-led" and "co-founded" are verbs too: the last part of a hyphenated opener decides.
const acted = (verb: string) => { const last = verb.split('-').pop() ?? verb; return VERBS.has(verb) || VERBS.has(last) || /\w{2,}ed$/.test(last); };

// The bullets of Experience and Projects, in order, each with the role it sits under.
function bulletsOf(markdown: string): { role: string; text: string }[] {
  const out: { role: string; text: string }[] = [];
  let section = '', role = '';
  for (const line of markdown.split('\n')) {
    const h2 = /^##\s+(.*)/.exec(line), h3 = /^###\s+(.*)/.exec(line), b = /^\s*[-*]\s+(.*)/.exec(line);
    if (h2) { section = h2[1].trim(); role = ''; } else if (h3) role = h3[1].trim();
    else if (b && /^(Experience|Projects)$/i.test(section)) out.push({ role, text: b[1].trim() });
  }
  return out;
}

// Each bullet: (25 for an action verb + 45 for a measured result + 30 for a named method or tool) less
// 40 for a duty statement, 25 for running past 35 words, 15 for a third bullet in a row on one verb.
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
    if (duty) { penalty += 40; flags.push({ quote: b.text, why: 'It opens as a duty, not as something done.', fix: 'Open with what the person did, as a past-tense verb.' }); }
    if (n > 35) { penalty += 25; flags.push({ quote: b.text, why: `It runs to ${n} words, past what a skim takes in.`, fix: 'Cut it to under 30 words, or split it if it says two things.' }); }
    if (run) { penalty += 15; flags.push({ quote: b.text, why: `It is the third bullet in a row to open with “${verb}”.`, fix: 'Open it with a different verb that is still exact.' }); }
    if (result) measured++;
    total += Math.max(0, (!duty && acted(verb) ? 25 : 0) + (result ? 45 : 0) + (method ? 30 : 0) - penalty);
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
  if (left.length) notes.push(`These terms from the posting are supported by the bank and missing from the resume: ${left.join(', ')}. Work each into the bullet whose work used it, or into Skills.`);
  if (room.score < 100) notes.push(`It runs to about ${count} words. ${pages === 1 ? 'One page' : 'Two pages'} read well between ${room.low} and ${room.high}: ${count < room.low ? 'add stronger work from the bank' : 'cut the weakest bullets'}.`);
  if (b.score < 70) notes.push(`${b.count - b.measured} of ${b.count} bullets state no measured result. Where the bank holds a result or a number worth showing for that same work, show it, and name the tool or method where the bank names one. Where it holds none, leave the bullet as it is: never invent one.`);
  return { score: overall(parts), parts, notes };
}
