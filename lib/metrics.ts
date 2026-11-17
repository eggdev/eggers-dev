// Rule 3, the metrics inventory: the measured results in the bank that a resume must not lose. Built in
// code from each fact's `metric`, with no model.
//
// Only impact metrics are in it, of the six kinds the rule names: users, revenue, latency, adoption, team
// size, time saved. There is no "other" kind. `metric` is free text, so a number is taken in only when the
// words beside it say which of the six it is. A date, a version, a count of tests, files, commits or tickets,
// and a small amount of money are never taken in: the person's standing rule is that such numbers make a
// resume look junior (SIGNAL in lib/writing.ts). When the words do not say, the number is left out. That
// costs only its protection here; the writer may still show it. A metric that also counts tests ("500 users, 40
// tests") keeps its impact number and loses the other.
//
// "The master" for one resume is every inventory metric of the roles that resume shows with bullets. A resume
// holds a metric when one of the metric's own numbers stands in that role's entry or in the summary.
import type { RoleRow } from './db.ts';
import { employers, normCompany } from './entries.ts';
import type { Resume } from './resume.ts';

export const KINDS = ['users', 'revenue', 'latency', 'adoption', 'team size', 'time saved'] as const;
export type MetricKind = (typeof KINDS)[number];
export type Metric = { fact: number; role: number | null; kind: MetricKind; text: string; tokens: string[] };
export type FactLite = { id: number; role_id: number | null; metric: string };

// Money under this, in a year, is incidental. A judgment, like the weights in lib/jobs.ts: change it here.
export const MIN_MONEY = 10_000;

// Numbers that are not results. Each is taken out of the text before anything is counted: versions, ports and
// standards; calendar dates; and counts of tests, files, endpoints, commits, pull requests, tickets and lines of code.
const NOISE = [/\b(?:python|java|angular|node(?:\.js)?|react|vue|go|ruby|php|swift|es|v)\s*\d+(?:\.\d+)*/g, /\b(?:port\s*\d{2,5}|http\s*[1-5]\d{2}|ipv[46]|http\/[123])\b/g, /\b(?:iso\s*\d{4,5}|soc\s*[123]|rfc\s*\d{3,5}|wcag\s*\d(?:\.\d)?|oauth\s*\d)\b/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/g, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/g, /\bq[1-4]\s*\d{4}\b/g, /\b\d{4}-\d{2}(?:-\d{2})?\b/g, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /(?<![$\d.,-])\b(?:19|20)\d{2}\b(?!\s*(?:%|\+|(?:[a-z-]+\s+)?(?:users|customers|clients|accounts|members|students|people|engineers|employees|hours|ms)\b))/g,
  // A ratio ("24/7") is a label, not a result. So is a percentile's name ("p95"): plain() turns it into the word "percentile" first.
  /\b\d+\/\d+\b/g,
  /\d[\d.,]*[kmb]?\+?\s*(?:[a-z-]+\s+){0,2}(?:tests?|test cases?|specs?|files?|endpoints?|commits?|pull requests?|prs|tickets?|lines? of code|loc)\b/g, /\d[\d.]*\s*%\s*(?:[a-z-]+\s+)?coverage\b/g, /\d+\s*days? ago\b/g];

const WORDS: Record<string, string> = { two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };
// Text with the noise gone and its numbers in one spelling: "12,000" as "12000", "1.2 million" as "1.2m", "40 percent" as "40%", "five" as "5".
const plain = (text: string) => NOISE.reduce((s, re) => s.replace(re, ' '), text.toLowerCase().replace(/\bp\d{2,3}\b/g, ' percentile ').replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => WORDS[w]))
  .replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d)\s*(?:percent|per cent)\b/g, '$1%').replace(/(\d)\s*million\b/g, '$1m').replace(/(\d)\s*billion\b/g, '$1b').replace(/(\d)\s*thousand\b/g, '$1k');
// The numbers in a text, each with the mark that makes it this number and not another: "$40k", "40%", "3x", "210".
export const numbersIn = (text: string): string[] => [...plain(text).matchAll(/\$?\d+(?:\.\d+)?(?:%|[kmbx]\b)?/g)].map((m) => m[0]);

const amount = (token: string) => Number(token.replace(/[$%kmbx]/g, '')) * (token.endsWith('k') ? 1e3 : token.endsWith('m') ? 1e6 : token.endsWith('b') ? 1e9 : 1);

// Which of the six kinds a metric is, or undefined when its words do not say. The order matters: the first that fits wins.
function kindOf(metric: string): MetricKind | undefined {
  const t = plain(metric), n = '\\d[\\d.]*[kmb]?\\+?';
  if (/\b(?:latency|percentile|response times?|load times?|page loads?|time to first|ttfb)\b|\d\s*(?:ms|milliseconds?)\b/.test(t)) return 'latency';
  if (new RegExp(`${n}\\s*(?:hours?|hrs?|days?|weeks?|minutes?|mins?|months?|seconds?|secs?)\\b`).test(t) && /\b(?:saved?|saves|saving|cut|reduced?|faster|down to|from\b.+\bto\b|instead of|turnaround|per (?:week|month|year|person|report))\b/.test(t)) return 'time saved';
  if (/\$\s*\d|\d\s*(?:usd|dollars)\b/.test(t)) {
    if (!/\b(?:revenue|arr|mrr|sales|bookings|income|profit|margin|funding|raised|saved?|savings|costs?|spend|budget|contracts?|deals?|pipeline|gmv|billings?|invoic\w+|payments?|processed)\b/.test(t)) return undefined;
    const money = [...t.matchAll(/\$\s*(\d+(?:\.\d+)?[kmb]?)/g)].map((m) => amount(m[1]));
    const yearly = Math.max(0, ...money) * (/\b(?:a|per|each|every)\s+month\b|\/\s*mo(?:nth)?\b|\bmonthly\b/.test(t) ? 12 : 1);
    return yearly >= MIN_MONEY ? 'revenue' : undefined;
  }
  // A share of money: revenue grown, or costs cut ("cut cloud costs by 30%"). The rule has no kind of its own for
  // money saved, so it goes with revenue, as an amount of money saved does above.
  if (/%/.test(t) && /\b(?:revenue|arr|mrr|sales|bookings|costs?|spend|spending|bills?|budget|expenses?)\b/.test(t)) return 'revenue';
  if (new RegExp(`${n}\\s*(?:[a-z-]+\\s+){0,2}(?:engineers?|developers?|designers?|analysts?|contractors?|direct reports|reports|hires?|people|staff)\\b|\\bteam of\\s*${n}|${n}[- ]person\\b`).test(t) && !/\b(?:use|uses|used|using|adopt\w*|serv\w+|onboard\w*|train\w*)\b/.test(t)) return 'team size';
  if (/\badopt\w*|\broll(?:ed)?[- ]?out\b|\bactive\b|\busage\b/.test(t) || new RegExp(`${n}\\s*(?:[a-z-]+\\s+){0,2}(?:teams?|departments?|offices?|organi[sz]ations?|companies|business units?|properties|sites?|locations?|stores?)\\b`).test(t)) return 'adoption';
  if (new RegExp(`${n}\\s*(?:[a-z-]+\\s+){0,2}(?:users?|customers?|clients?|accounts?|subscribers?|members?|students?|residents?|tenants?|employees|people|staff|visitors?|downloads?|installs?|sign-?ups?)\\b`).test(t)) return 'users';
  if (/%/.test(t) && /\b(?:faster|quicker|build times?|turnaround|cycle times?|time to)\b/.test(t)) return 'time saved';
  return undefined;
}

export function metricOf(f: FactLite): Metric | undefined {
  const text = (f.metric ?? '').trim();
  if (text === '') return undefined;
  const tokens = [...new Set(numbersIn(text))], kind = tokens.length ? kindOf(text) : undefined;
  return kind ? { fact: f.id, role: f.role_id, kind, text, tokens } : undefined;
}
export const inventory = (facts: FactLite[]): Metric[] => facts.map(metricOf).filter((m): m is Metric => m !== undefined);

// Whether a text shows a metric: one of the metric's numbers stands in it, as that same number.
// A bare number under 10 ("3") could be any 3 on the page, so it counts only when the metric has no surer number.
export function shows(text: string, m: Metric): boolean {
  const have = new Set(numbersIn(text)), sure = m.tokens.filter((t) => /[$%kmbx]/.test(t) || Number(t) >= 10);
  return (sure.length ? sure : m.tokens).some((t) => have.has(t));
}

export type Kept = { master: Metric[]; held: Metric[]; dropped: Metric[]; summaryOnly: Metric[] };
// The master for this resume, what of it the resume holds, and what it dropped. `summaryOnly` are metrics
// whose number is in the summary and not in their own role's bullets (rule 2 wants them in both).
export function kept(resume: Resume, metrics: Metric[], roles: RoleRow[]): Kept {
  const out: Kept = { master: [], held: [], dropped: [], summaryOnly: [] };
  for (const g of employers(roles)) {
    const ids = new Set([...g.rows, ...g.children].map((r) => r.id)), names = new Set(g.rows.map((r) => normCompany(r.company)));
    const entry = resume.experience.find((e) => e.bullets.length > 0 && names.has(normCompany(e.company || e.title)));
    if (!entry) continue;
    const body = [...entry.bullets, ...entry.notes].join('\n');
    for (const m of metrics.filter((x) => x.role !== null && ids.has(x.role))) {
      out.master.push(m);
      const inRole = shows(body, m), inSummary = shows(resume.summary, m);
      (inRole || inSummary ? out.held : out.dropped).push(m);
      if (inSummary && !inRole) out.summaryOnly.push(m);
    }
  }
  return out;
}
