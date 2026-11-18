// Numbers in the person's own words, for the rule that a number on a resume or in a message stands in a fact (the
// owner's rule 9). Two uses:
//
// 1. Redaction, before context is sent to a model (lib/jobs.ts, bank and brief; lib/outreach.ts). In what is context
//    and not evidence (a project's situation, what the person did, its result; what was learned; a kept line of "How
//    you work"), each number is replaced by "[number]" unless a fact of the same project holds it strictly: the same
//    value, the same kind of unit (a percent, money, a multiple such as "3x") and the same noun after it, which must
//    not be empty; or the same words after it (up to three), which must not be empty either. With no noun on either
//    side, and with no word after it, it is taken out. Only a name that needs no guess stays (below). The match is
//    strict on purpose: a number wrongly taken out only means the writer does not see it there, and the fact still has
//    it. The stored text is never changed.
//
// 2. The check after writing (lib/checks.ts, `context-number`; lib/outreach.ts). A number is unsupported when its
//    value stands in the context as stored and in no stated source (the facts the text may draw on). Only the value is
//    compared, with no unit and no noun, so a number written another way ("6 hrs" for "6 hours", "640 daily users",
//    "3x" for "3 times") is never a false alarm. A count of years is skipped: it comes from the role dates.
//
// Both read the same spellings as one value: "1,400", "1400", "1.4k", "1.4 thousand"; "$1.4M", "$1.4 million",
// "$1,400,000"; "31%", "31 percent"; number words up to ninety-nine, with "hundred" and "thousand" ("thirty-five", "a
// hundred"). "one" is left as a word: it is used as "a" far more often than as a count. Letters glued to a number are
// what it counts ("8hours", "210ms"). Names are no counts, and only names that need no guess:
// - a token of letters and digits ("S3", "EC2", "p95", "FY24", "2FA", "3D", "3rd");
// - a fixed standard or protocol with its number ("SOC 2", "ISO 27001", "HTTP 200", "HTTP/2", "OAuth 2.0");
// - the fixed labels "24/7" and "9/80" (any other "35/40" is two counts);
// - a number word joined by a hyphen to a word that is not a unit ("two-factor", "three-tier"). "35-depot" is a count.
// A version is no name in redaction ("Python 3.12" is sent as "Python [number]": the writer needs no version from the
// background). In the check, a version is no count only right after one of the person's tools, languages or platforms
// ("Node 20", "Python 3.12" when the person lists them); after any other word, dotted or not, a number is a count.
// In the check, what lib/metrics.ts treats as noise is not read either: dates and years, and counts of tests or files.
// Every reading is one pass over the text, so the time grows with its length, not with its square.
import { noiseSpans } from './metrics.ts';

export type Quantity = { text: string; value: number; unit: '' | 'percent' | 'money' | 'times'; noun: string; phrase: string };

const SMALL = ['zero', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const UNIT_WORDS = ['one', ...SMALL.slice(2, 10)];
const WORD_PART = `\\b(?:(${Object.keys(TENS).join('|')})(?:[-\\s]+(${UNIT_WORDS.join('|')}))?|(${SMALL.filter((w) => w !== '').join('|')})|(a))(?:\\s+(hundred))?(?:\\s+(thousand))?\\b`;
const DIGIT_PART = '([$€£¥]\\s?)?(\\d+(?:,\\d{3})*(?:\\.\\d+)?)(%|\\s?per\\s?cent\\b|\\s?percent\\b|[kK]\\b|\\s?thousand\\b|bn\\b|[bB]\\b|\\s?billion\\b|mn\\b|[mM]\\b|\\s?million\\b|[x×](?![a-z]))?';
const TOKEN = new RegExp(`${WORD_PART}|${DIGIT_PART}`, 'giu');
const wordValue = (tens?: string, unit?: string, small?: string, a?: string, hundred?: string, thousand?: string): number | undefined => {
  if (a && !hundred && !thousand) return undefined;
  let n = a ? 1 : tens ? TENS[tens.toLowerCase()] + (unit ? UNIT_WORDS.indexOf(unit.toLowerCase()) + 1 : 0) : SMALL.indexOf(small!.toLowerCase());
  if (hundred) n *= 100;
  if (thousand) n *= 1000;
  return n;
};
const SCALE = (s: string) => (/^\s?(k|thousand)$/i.test(s) ? 1e3 : /^\s?(m|mn|million)$/i.test(s) ? 1e6 : /^\s?(b|bn|billion)$/i.test(s) ? 1e9 : 1);

// Words after a number that say nothing about what it counts.
const STOP = new Set('of to in on at for by from and or the a an per more fewer less than over under across with into out up down about around nearly almost plus each every it its their our my his her that this which who as was were is are be been'.split(' '));
const singular = (w: string) => (w.endsWith('ies') && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') && w.length > 3 ? w.slice(0, -1) : w);
// Letters that may follow a number with no space and still say what it measures ("210ms", "6h", "40min", "10GB").
const UNITS = new Set(['h', 'hr', 'hrs', 'min', 'mins', 's', 'sec', 'secs', 'ms', 'us', 'ns', 'wk', 'wks', 'mo', 'mos', 'yr', 'yrs', 'kb', 'mb', 'gb', 'tb', 'pb', 'kbps', 'mbps', 'gbps', 'rps', 'qps', 'tps', 'px']);
// The words a number word may be joined to by a hyphen and still count ("thirty-minute", "two-person").
const COUNTED = new Set(['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year', 'person', 'people', 'member', 'man', 'seat', 'step', 'stage', 'part']);
// The names that need no guess, besides a token of letters and digits: a fixed standard or protocol with its number, and
// the fixed labels "24/7" and "9/80". Nothing else is read as a name.
const NAMES = [
  /\b(?:soc\s*[123]|iso\s*\d{4,5}(?:-\d+)?|https?\s*[1-5]\d{2}|https?\/[123](?:\.\d)?|oauth\s*\d(?:\.\d)?|rfc\s*\d{3,5}|wcag\s*\d(?:\.\d)?|tls\s*1\.[0-3]|ipv[46]|port\s*\d{2,5})\b/giu,
  /(?<![\d/])(?:24\/7|9\/80)(?![\d/])/g,
];
const NEXT_WORD = /\+?[\s-]*([\p{L}]+)/uy, GLUED = /[\p{L}]+/uy, AFTER = /(?:[^\S\n]{0,4}[^\s.;:!?]{1,40}){0,3}/uy;

type Found = Quantity & { at: number; end: number; name: boolean; before: string; year: boolean };
// Every number in a text, in one pass, with what is known about it. `blank` marks spans not to read at all.
function found(text: string, blank?: Uint8Array): Found[] {
  const named = new Uint8Array(text.length);
  for (const re of NAMES) for (const m of text.matchAll(re)) named.fill(1, m.index!, m.index! + m[0].length);
  const out: Found[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index!, whole = m[0];
    if (blank?.[at]) continue;
    let value: number, unit: Quantity['unit'] = '', name = named[at] === 1, end = at + whole.length;
    if (m[8] !== undefined) {
      const money = m[7] !== undefined, suffix = m[9] ?? '', prev = text[at - 1] ?? ' ';
      value = Number((Number(m[8].replace(/,/g, '')) * SCALE(suffix)).toPrecision(12));
      unit = money ? 'money' : /%|per\s?cent/i.test(suffix) ? 'percent' : /^[x×]$/.test(suffix) ? 'times' : '';
      // A token of letters and digits ("S3", "p95", "FY24"), part of a longer number, or of a name with a hyphen ("COVID-19").
      if (!money && (/[\p{L}_\d]/u.test(prev) || (prev === '.' && /\d/.test(text[at - 2] ?? '')) || (prev === '-' && /\p{L}/u.test(text[at - 2] ?? '')))) name = true;
    } else {
      const n = wordValue(m[1], m[2], m[3], m[4], m[5], m[6]);
      if (n === undefined) continue;
      value = n;
      // "two-factor", "three-tier": a number word joined to a word that counts nothing is part of a name.
      NEXT_WORD.lastIndex = end;
      const joined = text[end] === '-' ? NEXT_WORD.exec(text)?.[1]?.toLowerCase() : undefined;
      if (joined !== undefined && !COUNTED.has(singular(joined))) name = true;
    }
    // Letters glued to it: a unit ("210ms"), what it counts ("8hours"), or a name ("2FA", "3D", "3rd").
    GLUED.lastIndex = end;
    const glued = m[8] !== undefined ? GLUED.exec(text)?.[0] ?? '' : '';
    let noun = '';
    if (glued !== '') {
      const g = glued.toLowerCase();
      if (UNITS.has(g) || (g === glued && g.length >= 3 && !/^(st|nd|rd|th)$/.test(g))) noun = singular(g);
      else name = true;
    } else {
      NEXT_WORD.lastIndex = end;
      const next = NEXT_WORD.exec(text)?.[1]?.toLowerCase() ?? '';
      noun = STOP.has(next) ? '' : singular(next);
    }
    AFTER.lastIndex = end + glued.length;
    // The words right after it, up to three ("" when the clause ends there): a match needs words to compare.
    const phrase = `${glued}${AFTER.exec(text)?.[0] ?? ''}`.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, ' ').trim();
    const lead = text.slice(Math.max(0, at - 30), at), word = /([\p{L}][\p{L}.]*)\s+$/u.exec(lead);
    NEXT_WORD.lastIndex = end + glued.length;
    const year = noun === 'year' || noun === 'yr' || /^\+?\s*(years?|yrs?)\b/i.test(text.slice(end, end + 12)) || /\bsince\s+$/i.test(lead);
    out.push({ text: whole.trim(), value, unit, noun, phrase, at, end, name, before: word?.[1].toLowerCase() ?? '', year });
  }
  // A range ("900–1,000 drivers", "from 6 to 8 hours"): the first end counts what the second does.
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i], b = out[i + 1];
    if (a.unit === '' && a.noun === '' && b.at - a.end < 6 && /^\s*(?:–|—|-|to)\s*$/.test(text.slice(a.end, b.at))) Object.assign(a, { unit: b.unit, noun: b.noun });
  }
  return out;
}

// ---------- 1. Redaction ----------

// The strict reading of a text's numbers, for what a fact holds.
export const quantities = (text: string): Quantity[] => found(text).filter((f) => !f.name).map(({ text: t, value, unit, noun, phrase }) => ({ text: t, value, unit, noun, phrase }));
// Held: the same value and unit, with the same noun after it that is not empty, or the same words after it, which must not
// be empty either (a number that ends a clause in both texts compares nothing, so it is taken out).
const holds = (h: Quantity, q: Quantity) => h.value === q.value && h.unit === q.unit && ((q.noun !== '' && h.noun === q.noun) || (q.phrase !== '' && h.phrase === q.phrase));

export const NUMBER_TOKEN = '[number]';
// The text with each number that `held` does not hold strictly replaced by "[number]". Names stay as they are.
export function redact(text: string, held: Quantity[] = []): string {
  const parts: string[] = [];
  let from = 0;
  for (const f of found(text)) {
    if (f.name || held.some((h) => holds(h, f))) continue;
    parts.push(text.slice(from, f.at), NUMBER_TOKEN);
    from = f.at + f.text.length;
  }
  parts.push(text.slice(from));
  return parts.join('');
}

// ---------- 2. The check after writing ----------

// A long run of digits and separators is no number anyone wrote; it is left out before the noise patterns run on it.
const RUN = /[\d.,-]{41,}/g;
// The values a text uses as counts: noise, names and counts of years gone. `versions`: the names of the person's tools,
// languages and platforms (their endings such as ".js" left off), after which a version-shaped number is no count.
function read(text: string, opts: { versions?: string[] }, noise: ('dates' | 'counts')[]): Found[] {
  const blank = new Uint8Array(text.length);
  for (const m of text.matchAll(RUN)) blank.fill(1, m.index!, m.index! + m[0].length);
  for (const [a, b] of noiseSpans(text.replace(RUN, (r) => ' '.repeat(r.length)), noise)) blank.fill(1, a, b);
  const ending = /\.(js|ts|py|net)$/;
  const versions = new Set((opts.versions ?? []).map((v) => v.toLowerCase().replace(ending, '')));
  return found(text, blank).filter((f) => !f.name && !f.year
    && !(versions.has(f.before.replace(ending, '')) && (/^\d+\.\d+/.test(f.text) || (f.unit === '' && f.noun === ''))));
}
export const counts = (text: string, opts: { versions?: string[] } = {}): { text: string; value: number }[] => read(text, opts, ['dates', 'counts']).map((f) => ({ text: f.text, value: f.value }));

// The counts of `text` that `stated` (a fact, the facts a line cites) does not hold. A value the stated text holds only
// inside a count of tests or files ("212 tests") holds a bare number with no unit and no noun ("all 212 of them"), never a
// count of something else ("212 customers"). A value it holds only as a year or a date holds nothing. So the noise rule
// may make a check quieter, never louder.
export function unheld(text: string, stated: string, opts: { versions?: string[] } = {}): { text: string; value: number }[] {
  const strict = new Set(counts(stated, opts).map((x) => x.value)), inCounts = new Set(read(stated, opts, ['dates']).map((x) => x.value));
  return read(text, opts, ['dates', 'counts']).filter((x) => !strict.has(x.value) && !(inCounts.has(x.value) && x.unit === '' && x.noun === '')).map((f) => ({ text: f.text, value: f.value }));
}

// The numbers of `text` whose value stands in `context` and in no stated source: the value alone decides.
export function unsupported(text: string, context: string, stated: string, opts: { versions?: string[] } = {}): string[] {
  const inContext = new Set(counts(context, opts).map((x) => x.value));
  return [...new Set(unheld(text, stated, opts).filter((x) => inContext.has(x.value)).map((x) => x.text))];
}
