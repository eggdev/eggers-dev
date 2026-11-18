// `bun test lib`: the links from a resume's lines to its facts (lib/links.ts), with no database and no model. Every
// person, employer and number here is invented.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { annotate, carry, changedLines, checkLinks, keyMark, linkLines, parseLinks, places, storeLinks, stripLinks, takeLinks, type CitedFact, type Links } from './links.ts';

const role = (id: number, company: string, title: string, start: string, end = '', part_of: number | null = null): RoleRow =>
  ({ id, company, title, start, end, location: '', summary: '', standing: 'employer', reach: '', part_of, note: '', label: '' });
const ROLES = [role(1, 'Harborlight Systems', 'Director of Engineering', '2021-03'), role(2, 'Quillfeather Labs', 'Senior Engineer', '2016-01', '2021-02'), role(5, 'harborlight/dispatch', '', '2021-06', '2022-01', 1)];
const COMPANIES = ROLES.map((r) => r.company);
const fact = (id: number, role_id: number | null, text: string, metric = '', more: Partial<CitedFact> = {}): CitedFact => ({ id, role_id, text, metric, detail: '', baseline: '', team: '', own_part: '', skills: '', ...more });
const FACTS = [fact(1, 1, 'Built the dispatch console that schedulers use every day.', '640 users across 12 depots'), fact(2, 1, 'Cut the nightly billing run.', 'from 6 hours to 40 minutes'),
  fact(4, 2, 'Rebuilt the quoting API.', 'p95 latency 900 ms to 210 ms'), fact(7, 5, 'Wrote the dispatch queue.', '', { detail: 'It took 3 weeks.' }), fact(9, null, 'Speaks at meetups.')];

const WRITTEN = `# Avery Lindqvist
line

## Summary
Engineer with 14 years building logistics software in Go. {fact:1, fact:4}

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present {fact:1}
- Build the dispatch console that 640 users across 12 depots open every day. {fact:1}
- Cut the nightly billing run from 6 hours to 40 minutes [fact:2].
- Wrote the dispatch queue (fact:7)

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021
- Rebuilt the quoting API, cutting p95 latency from 900 ms to 210 ms. {fact:4, project:3}

## Skills
Go, TypeScript {fact:2}`;

test('takeLinks takes every key out, and keeps each bullet’s and the Summary’s as cites', () => {
  const { clean, cites } = takeLinks(WRITTEN, COMPANIES);
  expect(clean).not.toMatch(/fact|project:/);
  expect(clean).toContain('- Cut the nightly billing run from 6 hours to 40 minutes.\n');
  expect(clean).toContain('Mar 2021 – Present\n');
  expect(clean.endsWith('Go, TypeScript')).toBe(true);
  expect(cites).toEqual([
    { where: 'summary', text: 'Engineer with 14 years building logistics software in Go.', facts: [1, 4], refused: [] },
    { where: 'bullet', text: 'Build the dispatch console that 640 users across 12 depots open every day.', facts: [1], refused: [] },
    { where: 'bullet', text: 'Cut the nightly billing run from 6 hours to 40 minutes.', facts: [2], refused: [] },
    { where: 'bullet', text: 'Wrote the dispatch queue', facts: [7], refused: [] },
    { where: 'bullet', text: 'Rebuilt the quoting API, cutting p95 latency from 900 ms to 210 ms.', facts: [4], refused: ['project:3'] },
  ]);
});

test('a text with no key comes back exactly as it was, from takeLinks and from stripLinks', () => {
  const plain = '# A\n\n## Summary\nEngineer.  \n\n## Experience\n### Engineer, Globex\n- Did a thing (with care). \n- Role: 2 teams\n';
  expect(takeLinks(plain)).toEqual({ clean: plain, cites: [] });
  expect(stripLinks(plain)).toBe(plain);
  expect(stripLinks('- Did it {fact:3}\n- And {fact: 4 , fact:5}.')).toBe('- Did it\n- And.');
});

test('linkLines matches cites to the lines code left, and a line given no key keeps the link of the same words', () => {
  const { clean, cites } = takeLinks(WRITTEN, COMPANIES);
  const first = linkLines(clean, cites, COMPANIES);
  expect(first.lines.map((l) => [l.where, l.entry, l.facts])).toEqual([['summary', '', [1, 4]], ['bullet', 'harborlight systems', [1]], ['bullet', 'harborlight systems', [2]], ['bullet', 'harborlight systems', [7]], ['bullet', 'quillfeather labs', [4]]]);
  const pool = new Map(first.lines.map((l) => [`${l.where}\u0000${l.where === 'summary' ? '' : l.entry}\u0000${l.text}`, l]));
  // A rewrite that drops the keys of an unchanged bullet and rewords another.
  const again = takeLinks(stripLinks(WRITTEN).replace('Wrote the dispatch queue', 'Wrote the dispatch queue in Go {fact:7}'), COMPANIES);
  const next = linkLines(again.clean, again.cites, COMPANIES, pool);
  expect(next.lines.map((l) => [l.text, l.facts])).toEqual([['Engineer with 14 years building logistics software in Go.', [1, 4]], ['Build the dispatch console that 640 users across 12 depots open every day.', [1]],
    ['Cut the nightly billing run from 6 hours to 40 minutes.', [2]], ['Wrote the dispatch queue in Go', [7]], ['Rebuilt the quoting API, cutting p95 latency from 900 ms to 210 ms.', [4]]]);
  // The same words under another employer are another claim: no link from the pool.
  const moved = takeLinks(stripLinks(WRITTEN).replace('- Rebuilt the quoting API, cutting p95 latency from 900 ms to 210 ms.', '- Cut the nightly billing run from 6 hours to 40 minutes.'), COMPANIES);
  expect(linkLines(moved.clean, moved.cites, COMPANIES, pool).lines.filter((l) => l.entry === 'quillfeather labs')).toEqual([]);
});

test('annotate puts each line’s keys back at its end, and takeLinks reads them again to the same links', () => {
  const { clean, cites } = takeLinks(WRITTEN, COMPANIES), links = linkLines(clean, cites, COMPANIES);
  const shown = annotate(clean, links, COMPANIES);
  expect(shown).toContain('Engineer with 14 years building logistics software in Go. {fact:1, fact:4}');
  expect(shown).toContain('- Rebuilt the quoting API, cutting p95 latency from 900 ms to 210 ms. {fact:4, project:3}');
  expect(shown).toContain('Mar 2021 – Present\n');
  const back = takeLinks(shown, COMPANIES);
  expect(back.clean).toBe(clean);
  expect(linkLines(back.clean, back.cites, COMPANIES)).toEqual(links);
  expect(annotate(clean, null, COMPANIES)).toBe(clean);
  expect(parseLinks(storeLinks(links))).toEqual(links);
  expect([parseLinks(''), parseLinks('not json'), storeLinks(null)]).toEqual([null, null, '']);
});

test('the four findings, each with its place, and the lines a number check covers', () => {
  const text = `# A
line

## Summary
Engineer with 14 years who cut a billing run to 40 minutes.

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present
- Served 640 users across 12 depots and 2.4M requests.
- Cut the nightly billing run from 6 hours to 40 minutes.
- Spoke at meetups.
- Wrote a deleted thing.
- Ran the on-call rota.
- Wrote the dispatch queue in 3 weeks.`;
  const at = (t: string) => ({ where: 'bullet' as const, entry: 'harborlight systems', text: t, facts: [] as number[], edited: 0 });
  const links: Links = { v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer with 14 years who cut a billing run to 40 minutes.', facts: [2, 9], edited: 0 },
    { ...at('Served 640 users across 12 depots and 2.4M requests.'), facts: [1] }, { ...at('Cut the nightly billing run from 6 hours to 40 minutes.'), facts: [4] },
    { ...at('Spoke at meetups.'), facts: [9] }, { ...at('Wrote a deleted thing.'), facts: [3, 1] }, { ...at('Wrote the dispatch queue in 3 weeks.'), facts: [7] }] };
  const { findings, linked } = checkLinks(text, links, { facts: FACTS, roles: ROLES });
  expect(findings.map((f) => [f.kind, f.severity, f.place.text])).toEqual([
    ['link-number', 'high', 'Served 640 users across 12 depots and 2.4M requests.'],
    ['link-elsewhere', 'high', 'Cut the nightly billing run from 6 hours to 40 minutes.'],
    ['unlinked', 'warn', 'Cut the nightly billing run from 6 hours to 40 minutes.'],
    ['link-elsewhere', 'high', 'Spoke at meetups.'],
    ['unlinked', 'warn', 'Spoke at meetups.'],
    ['link-unknown', 'high', 'Wrote a deleted thing.'],
    ['unlinked', 'warn', 'Ran the on-call rota.'],
  ]);
  expect(findings[0].text).toBe('“Served 640 users across 12 depots and 2.4M requests.” uses 2.4M, which is in none of the facts it cites. F-0001 says “Built the dispatch console that schedulers use every day. (640 users across 12 depots)”. Take it out, or cite the fact that states it.');
  expect(findings[1].text).toBe('“Cut the nightly billing run from 6 hours to 40 minutes.” cites F-0004, which your record has under Quillfeather Labs, not under Harborlight Systems. A line cites only facts of its own job.');
  expect(findings[3].text).toContain('which your record has under no job');
  expect(findings[5].text).toBe('“Wrote a deleted thing.” cites F-0003, which is no longer in your record. A link is never moved to another fact: cite one your record has.');
  expect(findings[6].text).toBe('“Ran the on-call rota.” names no fact of your record that it draws on.');
  // The summary may cite any fact; its count of years is left to the dates. A project's fact belongs to its employer,
  // and its story ("3 weeks") holds the line's number.
  expect(linked.size).toBe(4);
  expect(checkLinks(text, null, { facts: FACTS, roles: ROLES })).toEqual({ findings: [], linked: new Set() });
});

test('a refused key is said in words, and a line the owner wrote is only for information', () => {
  const text = '## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n- Mentored two engineers.';
  const links: Links = { v: 1, lines: [{ where: 'bullet', entry: 'quillfeather labs', text: 'Rebuilt the quoting API.', facts: [4], refused: ['project:3'], edited: 0 },
    { where: 'bullet', entry: 'quillfeather labs', text: 'Mentored two engineers.', facts: [], edited: 1_700_000_000_000 }] };
  const { findings } = checkLinks(text, links, { facts: FACTS, roles: ROLES });
  expect(findings.map((f) => [f.kind, f.severity, f.text])).toEqual([
    ['link-unknown', 'high', '“Rebuilt the quoting API.” cites project:3, which is not a fact. Only a fact of your record stands behind a line.'],
    ['unlinked', 'info', 'You wrote “Mentored two engineers.”, so no fact of your record is linked to it.'],
  ]);
});

const doc = (h: string[], q: string[], summary = 'Engineer.') => `## Summary\n${summary}\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n${h.map((b) => `- ${b}`).join('\n')}\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n${q.map((b) => `- ${b}`).join('\n')}`;
const at = (text: string, facts: number[], entry = 'harborlight systems') => ({ where: 'bullet' as const, entry, text, facts, edited: 0 });
const row = (l: { entry: string; text: string; facts: number[]; edited: number }) => [l.entry, l.text, l.facts, l.edited];

test('carry: unchanged lines keep their link, a line replaced in place keeps its facts as edited, a merged or added line has none', () => {
  const before = doc(['One.', 'Shipped the routing service.', 'Three.', 'Four.', 'Five.'], ['Six.']);
  const links: Links = { v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer.', facts: [1], edited: 0 }, at('One.', [1]), at('Shipped the routing service.', [2]), at('Three.', [1, 2]), at('Four.', [2]), at('Five.', [1]), at('Six.', [4], 'quillfeather labs')] };
  // The summary and "Two." are reworded in place, "Four." and "Five." are merged into one, and a line is added.
  const after = doc(['One.', 'Shipped the routing service, on time.', 'Three.', 'Four and five.'], ['Six.', 'Seven.'], 'Engineer and lead.');
  expect(carry(before, after, links, COMPANIES, 99)!.lines.map(row)).toEqual([
    ['', 'Engineer and lead.', [1], 99],
    ['harborlight systems', 'One.', [1], 0],
    ['harborlight systems', 'Shipped the routing service, on time.', [2], 99],
    ['harborlight systems', 'Three.', [1, 2], 0],
    ['harborlight systems', 'Four and five.', [], 99],
    ['quillfeather labs', 'Six.', [4], 0],
    ['quillfeather labs', 'Seven.', [], 99],
  ]);
  expect(carry(before, before, links, COMPANIES, 99)).toEqual(links);
  expect(carry(before, after, null, COMPANIES, 99)).toBeNull();
  expect([changedLines(before, after), changedLines(before, before), changedLines('a\nb', 'a\nc\nb')]).toEqual([5, 0, 1]);
});

test('carry: the same words moved within their job keep their link; moved to another job, they have none', () => {
  const before = doc(['One.', 'Shipped the routing service.', 'Three.'], ['Six.']);
  const links: Links = { v: 1, lines: [at('One.', [1]), at('Shipped the routing service.', [2]), at('Three.', [1]), at('Six.', [4], 'quillfeather labs')] };
  expect(carry(before, doc(['Shipped the routing service.', 'Three.', 'One.'], ['Six.']), links, COMPANIES, 99)!.lines.map(row)).toEqual([
    ['harborlight systems', 'Shipped the routing service.', [2], 0], ['harborlight systems', 'Three.', [1], 0], ['harborlight systems', 'One.', [1], 0], ['quillfeather labs', 'Six.', [4], 0]]);
  expect(carry(before, doc(['Shipped the routing service.', 'Three.'], ['Six.', 'One.']), links, COMPANIES, 99)!.lines.map(row)).toEqual([
    ['harborlight systems', 'Shipped the routing service.', [2], 0], ['harborlight systems', 'Three.', [1], 0], ['quillfeather labs', 'Six.', [4], 0], ['quillfeather labs', 'One.', [], 99]]);
});

test('places names the Summary once, on its last line, and each Experience bullet with its employer', () => {
  const md = '# A\nline\n\n## Summary\nFirst line.\nSecond line.\n\n## Experience\n### Engineer, Globex\n2020 – 2021\nA context line.\n- Did it.\n\n## Projects\n### Sketch\n- Made it.';
  expect(places(md).places).toEqual([{ where: 'summary', entry: '', text: 'First line. Second line.', line: 5, n: -1 }, { where: 'bullet', entry: 'globex', text: 'Did it.', line: 11, n: 0 }]);
});

// ---------- carry(): only a plain reword keeps its facts (review finding 2); an employer's name edited keeps the job (4) ----------
const A1 = 'Built the console for 640 users.', B2 = 'Cut billing from 6 hours to 40 minutes.', C3 = 'Wrote 212 tests.';
const three: Links = { v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer.', facts: [1], edited: 0 }, at(A1, [1]), at(B2, [2]), at(C3, [3])] };
const bulletsOf = (l: Links | null) => l!.lines.filter((x) => x.where === 'bullet').map((x) => [x.text, x.facts, x.edited > 0]);

test('carry: a line that only takes another’s place gets none of its facts, and no number check runs on it', () => {
  // The owner rewords A, moves it below B and deletes C: the reworded line takes C's place, and is not C.
  const moved = carry(doc([A1, B2, C3], []), doc([B2, 'Built the routing console for 640 users.'], []), three, COMPANIES, 9);
  expect(bulletsOf(moved)).toEqual([[B2, [2], false], ['Built the routing console for 640 users.', [], true]]);
  // The owner deletes C and adds a line of their own.
  const added = carry(doc([A1, B2, C3], []), doc([A1, B2, 'Mentored 4 interns.'], []), three, COMPANIES, 9);
  expect(bulletsOf(added)).toEqual([[A1, [1], false], [B2, [2], false], ['Mentored 4 interns.', [], true]]);
  // So no high flag is raised against the owner's own true number.
  const md = doc([A1, B2, 'Mentored 4 interns.'], []);
  expect(checkLinks(md, added, { facts: [...FACTS, fact(3, 1, 'Wrote the test suite.', '212 tests')], roles: ROLES }).findings.map((f) => [f.kind, f.severity])).toEqual([['unlinked', 'info']]);
});

test('carry: a plain reword keeps its facts; a reword that changes the number keeps them and is checked', () => {
  const plain = carry(doc([A1, B2, C3], []), doc(['Built the routing console for 640 users.', B2, C3], []), three, COMPANIES, 9);
  expect(bulletsOf(plain)[0]).toEqual(['Built the routing console for 640 users.', [1], true]);
  const number = carry(doc([A1, B2, C3], []), doc(['Built the console for 900 users.', B2, C3], []), three, COMPANIES, 9)!;
  expect(bulletsOf(number)[0]).toEqual(['Built the console for 900 users.', [1], true]);
  const md = doc(['Built the console for 900 users.', B2, C3], []);
  const found = checkLinks(md, number, { facts: [...FACTS, fact(3, 1, 'Wrote the test suite.', '212 tests')], roles: ROLES }).findings;
  expect(found.map((f) => [f.kind, f.place.text])).toEqual([['link-number', 'Built the console for 900 users.']]);
  // A shared number and a quarter of the words is enough: "Cut billing from 6 hours to 40 minutes." said another way.
  const said = carry(doc([A1, B2, C3], []), doc([A1, 'Moved nightly billing off the 6 hour batch window.', C3], []), three, COMPANIES, 9);
  expect(bulletsOf(said)[1]).toEqual(['Moved nightly billing off the 6 hour batch window.', [2], true]);
});

test('carry: an employer’s name edited on its heading keeps the links of the bullets under it', () => {
  const before = doc([A1, B2], ['Six.']), after = before.replace('### Director of Engineering, Harborlight Systems', '### Director of Engineering, Harborlight');
  const links: Links = { v: 1, lines: [at(A1, [1]), at(B2, [2]), at('Six.', [4], 'quillfeather labs')] };
  expect(carry(before, after, links, COMPANIES, 9, ROLES)!.lines.map((l) => [l.entry, l.text, l.facts, l.edited])).toEqual([
    ['harborlight', A1, [1], 0], ['harborlight', B2, [2], 0], ['quillfeather labs', 'Six.', [4], 0]]);
});

// ---------- carry(): the old line at a place is the single closest to the new line (review finding B) ----------
const DEPLOY = 'Cut deploy time from 47 to 9 minutes.', REVIEW = 'Ran weekly code review sessions.', BUILD = 'Cut build time from 47 to 9 minutes.';
const twins: Links = { v: 1, lines: [at(DEPLOY, [1]), at(REVIEW, [5]), at(BUILD, [2])] };
// The findings on the bullets (the Summary here has no link of its own).
const flagsFor = (md: string, l: Links) => checkLinks(md, l, { facts: [...FACTS, fact(5, 1, 'Ran weekly code review sessions.')], roles: ROLES }).findings.filter((f) => f.place.where === 'bullet').map((f) => [f.kind, f.severity]);

test('carry: a build line put in the deploy line’s place gets no link, since the old build line is closer', () => {
  const after = doc(['Cut build time from 47 to 8 minutes.', REVIEW], []);
  const got = carry(doc([DEPLOY, REVIEW, BUILD], []), after, twins, COMPANIES, 9)!;
  expect(bulletsOf(got)).toEqual([['Cut build time from 47 to 8 minutes.', [], true], [REVIEW, [5], false]]);
  expect(flagsFor(after, got)).toEqual([['unlinked', 'info']]);
  // The same with equal numbers: still no link, and the build line's own facts are not taken either.
  const same = doc(['Cut the build time from 47 to 9 minutes.', REVIEW], []);
  expect(bulletsOf(carry(doc([DEPLOY, REVIEW, BUILD], []), same, twins, COMPANIES, 9))).toEqual([['Cut the build time from 47 to 9 minutes.', [], true], [REVIEW, [5], false]]);
});

test('carry: a plain reword with no near twin keeps its facts', () => {
  const got = carry(doc([DEPLOY, REVIEW], []), doc(['Cut deploy time from 47 to 7 minutes.', REVIEW], []), { v: 1, lines: [at(DEPLOY, [1]), at(REVIEW, [5])] }, COMPANIES, 9);
  expect(bulletsOf(got)).toEqual([['Cut deploy time from 47 to 7 minutes.', [1], true], [REVIEW, [5], false]]);
});

test('carry: a reword in place keeps its facts when its old line is strictly the closest, even beside a near twin', () => {
  const got = carry(doc([DEPLOY, REVIEW, BUILD], []), doc(['Cut deploy time from 47 to 7 minutes.', REVIEW, BUILD], []), twins, COMPANIES, 9);
  expect(bulletsOf(got)).toEqual([['Cut deploy time from 47 to 7 minutes.', [1], true], [REVIEW, [5], false], [BUILD, [2], false]]);
});

test('carry: a reword in place that an untouched twin matches as closely as its old line has no link', () => {
  // "release" is neither "deploy" nor "build": the untouched build line is as close as the old deploy line.
  const got = carry(doc([DEPLOY, REVIEW, BUILD], []), doc(['Cut release time from 47 to 7 minutes.', REVIEW, BUILD], []), twins, COMPANIES, 9);
  expect(bulletsOf(got)).toEqual([['Cut release time from 47 to 7 minutes.', [], true], [REVIEW, [5], false], [BUILD, [2], false]]);
});

// ---------- What is left when a key is taken out, and what is never a key (review finding D) ----------
const summaryOf = (md: string) => takeLinks(md).clean.split('\n')[1];
test('the lead-in or mark that only served a key goes with it', () => {
  const cases: [string, string][] = [['(see {fact:1})', 'Engineer.'], ['{fact:1}-{fact:2}', 'Engineer.'], ['— {fact:1}', 'Engineer.'], ['{fact:1}; more text', 'Engineer. more text'],
    ['(source: {fact:1})', 'Engineer.'], ['Built X (in 2021 {fact:1})', 'Engineer. Built X (in 2021)']];
  for (const [written, left] of cases) expect([written, summaryOf(`## Summary\nEngineer. ${written}`)]).toEqual([written, left]);
  // A bullet made of a key alone keeps its bullet mark.
  expect(takeLinks('## Experience\n### Engineer, Globex\n2020 – 2021\n- {fact:1}').clean.split('\n').pop()).toBe('-');
});

test('true text is left as written, and never named as a printed key', () => {
  // A reference alone in round brackets is left in the text, and named on a model's line (the next test), never taken out.
  for (const l of ['Filed the form (F-0012) for 9 sites.', 'Led the (F-1065) filings for 30 firms.']) expect([l, summaryOf(`## Summary\n${l}`), keyMark(l)]).toEqual([l, l, l.match(/\(F-\d+\)/)![0]]);
  const kept = ['Sold F-150 trucks to 40 fleets.', 'Wrote (3 facts, 2 roles) per page.', 'Moved 4 roles (role: 2) to Go.', 'Supported the (F-16 program).', 'Sold (F-150 trucks).', 'Filed the (Form F-1065).',
    'Cut errors 40% (facts 2023-2024).', 'Ran audits (fact-checked 3 reports).', 'Merged duplicates [3 facts] per record.', 'Kept the {facts} store at 99.9%.', 'Hired (project: 2 people).'];
  for (const l of kept) expect([l, summaryOf(`## Summary\n${l}`), keyMark(l)]).toEqual([l, l, null]);
  // Outside brackets only the exact key is named.
  for (const l of ['Audited the facts: 12 services moved.', 'Built fact #3 of the plan.', 'Wrote "fact: 4" templates.', 'Filed the ISO F-0012 form.']) expect([l, keyMark(l)]).toEqual([l, null]);
  expect(keyMark('Built the console (see fact:12).')).toBe('fact:12');
  expect(keyMark('Built the console {F-0012}.')).toBe('{F-0012}');
});
