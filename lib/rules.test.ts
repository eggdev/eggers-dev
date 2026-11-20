// `bun test lib`: the writing rules as code (lib/rules.ts). The exact rules refuse a text, and "not checked" is never
// read as "passed". The checklist only measures, and never reaches a writer. Every person, company and number here is
// invented.
import { expect, test } from 'bun:test';
import type { RoleRow } from './db.ts';
import { APPLIES, BANNED_FORMS, BANNED_WORDS, check, CHECKLIST_RULES, EXACT_RULES, LIMITS, limitsFor, PROMPT_BANNED_WORDS, retryNote, SURFACES, verdictOf, type ChecklistItem, type ChecklistRule, type Context, type ExactRule, type HitOf, type RuleResult, type Surface, type Verdict } from './rules.ts';
import { places } from './links.ts';
import { WRITING } from './writing.ts';

const role = (id: number, title: string, company: string, start: string, end: string, more: Partial<RoleRow> = {}): RoleRow =>
  ({ id, company, title, start, end, location: '', summary: '', standing: 'employer', reach: '', part_of: null, note: '', label: '', ...more });
const ROLES = [
  role(1, 'Director of Engineering', 'Harborlight Systems', '2021-03', '', { location: 'Remote' }),
  role(2, 'Staff Engineer', 'Quillfeather Labs', '2019-01', '2021-02'),
  role(3, 'Senior Engineer', 'Quillfeather Labs', '2016-01', '2018-12'),
];
const TECH = ['Go', 'Kafka', 'Postgres', 'Redis', 'Docker', 'Terraform', 'React', 'React Native', 'R', 'C'];
const RECORD = { stated: 'Built the dispatch console. 640 users across 12 depots open it every day. Led a team of 6 engineers. Rebuilt the quoting API.' };
const RESUME = `# Avery Lindqvist
avery@lindqvist.example · 555 0100

## Summary
Engineer building logistics software in Go for depots and their schedulers.

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present · Remote
- Build the dispatch console that 640 users across 12 depots open every day.
- Lead a team of 6 engineers on Go and Kafka services.

### Staff Engineer, Quillfeather Labs
Jan 2019 – Feb 2021
Previously Senior Engineer, Jan 2016 – Dec 2018
- Rebuilt the quoting API in Go.

## Skills
Go, Kafka, Postgres, Redis, Docker, Terraform
`;
// The facts each line with a number cites, keyed as lib/links.ts keys a line (places): a bullet by its text.
const CITES = new Map([
  ['Build the dispatch console that 640 users across 12 depots open every day.', 'Built the dispatch console. 640 users across 12 depots open it every day.'],
  ['Lead a team of 6 engineers on Go and Kafka services.', 'Led a team of 6 engineers.'],
]);
const FILE_OK: Context['file'] = { 'single-column-file': { ok: true }, 'parser-reads-record': { ok: true } };
const PERSON = { name: 'Avery Lindqvist', contact: ['avery@lindqvist.example', '555 0100'] };
const EDUCATION = 'B.S. Computer Science, Lakehead State, 2008';
// Everything a resume needs to be ready.
const READY: Context = { technologies: TECH, roles: ROLES, record: { ...RECORD, cites: CITES }, file: FILE_OK, pages: 1, person: PERSON, education: [EDUCATION] };
const citing = (line: string, fact: string): Context => ({ ...READY, record: { ...RECORD, cites: new Map([...CITES, [line, fact]]) } });

const result = <R extends ExactRule>(c: ReturnType<typeof check>, rule: R) => c.exact.find((r) => r.rule === rule) as RuleResult<R> | undefined;
const item = <R extends ChecklistRule>(c: ReturnType<typeof check>, rule: R) => c.checklist.find((x) => x.rule === rule) as Extract<ChecklistItem, { rule: R }>;
const hitsOf = <R extends ExactRule>(c: ReturnType<typeof check>, rule: R): HitOf[R][] => { const r = result(c, rule) as RuleResult | undefined; return r?.state === 'break' ? ([...r.hits] as HitOf[R][]) : []; };
const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const banned = (text: string, context?: Context) => hitsOf(check('answer', text, context), 'banned-word');
const found = (text: string, context?: Context) => banned(text, context).map((h) => h.found);

// ---------- Banned words ----------

test('the prompt names the fifteen words it always named, in the same words, and code bans those and five more', () => {
  expect(WRITING).toContain('- Plain words. Never: leverage, utilize, facilitate, foster, enhance, showcase, robust, seamless, spearheaded, cutting-edge, passionate, delve, crucial, pivotal, landscape. Write "use"');
  expect(BANNED_WORDS.length).toBe(20);
  expect(new Set(BANNED_WORDS).size).toBe(20);
  for (const w of PROMPT_BANNED_WORDS) expect(BANNED_WORDS).toContain(w);
  for (const w of ['orchestrated', 'honed', 'streamlined', 'dynamic', 'results-driven'] as const) expect(BANNED_WORDS).toContain(w);
});

test('every banned word is found in each of its forms, in any case, with its line and quote', () => {
  for (const word of BANNED_WORDS) {
    expect([word, BANNED_FORMS[word].length >= 2]).toEqual([word, true]);
    for (const form of BANNED_FORMS[word]) {
      for (const shown of [form, form.toUpperCase(), form[0].toUpperCase() + form.slice(1)]) {
        const hits = banned(`Fine line.\nThe team ${shown} the depot plan.`);
        expect([shown, hits.map((h) => ({ word: h.word, found: h.found, line: h.line, quote: h.quote }))]).toEqual([shown, [{ word, found: shown, line: 2, quote: `The team ${shown} the depot plan.` }]]);
      }
    }
  }
  expect(banned('Leveraged Kafka. Utilising queues. Seamlessly moved. Spearheading it. Orchestrating jobs. Honing skills. Streamlines intake. Dynamically sized. Results driven.').map((h) => h.word))
    .toEqual(['leverage', 'utilize', 'seamless', 'spearheaded', 'orchestrated', 'honed', 'streamlined', 'dynamic', 'results-driven']);
});

test('the dashes this project prints still join a banned phrase', () => {
  expect(banned('A cutting-edge, results–driven, cutting—edge, cutting edge tool.').map((h) => h.word)).toEqual(['cutting-edge', 'cutting-edge', 'cutting-edge', 'results-driven']);
  expect(banned('ok\r\nrobust').map((h) => h.line)).toEqual([2]);
});

test('a line with a character outside the plain set, or Markdown marks, is never vouched for', () => {
  const fact = 'Built the dispatch console. 640 users across 12 depots open it every day.';
  const profile = (text: string) => check('profile', text, { record: { ...RECORD, cites: new Map([[text, fact]]) } });
  // Digits that are not ASCII digits are no number the code reads: neither rule can pass the line.
  const wide = profile('Built the dispatch console for ６４０ users.');
  expect([wide.verdict, result(wide, 'banned-word'), result(wide, 'number-held-by-record')?.state]).toEqual(['unverified', { rule: 'banned-word', state: 'not-checked', why: 'Line 1: it holds a character the check does not read.' }, 'not-checked']);
  // A soft hyphen, a zero-width space or Markdown marks in or beside a word hide a banned word or what a number counts.
  for (const text of ['We lever\u00ADaged the depot data.', 'We stream\u200Blined intake.', 'Built a ro**bust** console.', 'Built a *ro*bust console.', 'Built a cutting **edge** console.', 'Serves **640** users.']) {
    expect([text, profile(text).verdict, result(profile(text), 'banned-word')?.state]).toEqual([text, 'unverified', 'not-checked']);
  }
  // A banned word written plainly on such a line is still refused.
  expect(profile('A robust console, stream\u200Blined.').verdict).toBe('refused');
  // Latin letters with accents are in the plain set: a line with an accented name is read and checked.
  expect(hitsOf(profile('Built the dispatch console with José Müller for 900 users.'), 'number-held-by-record').map((h) => h.number)).toEqual(['900']);
  expect(profile('Built the dispatch console with José Müller for 640 users.').verdict).toBe('ready');
});

test('a word that only contains a banned word is not matched', () => {
  const clean = 'An honest honestly honesty review. The enhancement shipped. Fluid dynamics and Dynamics 365. Robustness tests. Landscaping and landscaped yards at Pinecrest Commons. Utilization rose. Seamlessness. Fosterling Bay Freight. Delver. Crucible. Pivots. Orchestral music. Phoned and honey. Unleveraged.';
  expect(found(clean)).toEqual([]);
  expect(banned('A non-robust queue.').map((h) => h.word)).toEqual(['robust']);
});

test('a listed term excuses only the banned word inside it; filler beside it and terms not on the list still break', () => {
  const honest = 'Built dynamic pricing for 3 markets. Supported portrait and landscape layouts. Modeled leverage ratios. Ran robust regression.';
  expect(found(honest)).toEqual([]);
  expect(found('Built dynamic pricing with a dynamic team.')).toEqual(['dynamic']);
  expect(found('Used dynamic imports and dynamic routing. Hired a landscape architect for landscape design. Added Dynamic Type support.', { names: ['Dynamic Type'] })).toEqual([]);
  expect(found('I bring a dynamic range of robust statistics on the landscape mode of work.')).toEqual(['robust', 'landscape', 'dynamic']);
});

test('a name excuses only a banned word inside it, as written with its own case', () => {
  const honest = 'Used Pivotal Tracker and Microsoft Delve. MBA, Foster School of Business.';
  expect(found(honest)).toEqual(['Foster', 'Delve', 'Pivotal']);
  expect(found(honest, { names: ['Pivotal Tracker', 'Microsoft Delve', 'Foster School of Business'] })).toEqual([]);
  // A one-word name counts only with its capital: it never excuses the plain word.
  expect(found('I played a pivotal role, and I delve into data to foster trust.', { names: ['Pivotal', 'Delve', 'Foster'] })).toEqual(['foster', 'delve', 'pivotal']);
  expect(found('Tracked the work in Pivotal and searched it in Delve.', { names: ['Pivotal', 'Delve'] })).toEqual([]);
  // A name that covers only part of a banned phrase excuses nothing.
  expect(found('Built cutting-edge tools.', { technologies: ['Edge', 'Go'] })).toEqual(['cutting-edge']);
  // The record's employers are names; the same words in lower case are filler.
  const roles = [role(9, 'Director', 'Robust Freight', '2020-01', '')];
  expect(found('I lead engineering at Robust Freight.', { roles })).toEqual([]);
  expect(found('I wrote a robust freight plan.', { roles })).toEqual(['robust']);
});

test('a name of one word excuses a banned word only right after a word of its sentence', () => {
  const profile = (text: string, context: Context) => check('profile', text, { record: RECORD, ...context }).verdict;
  const at = (company: string) => [role(7, 'Staff Engineer', company, '2019-01', '2021-02')];
  // The record's employer as the first word of a sentence, or after anything but a word, is the filler word.
  expect(profile('Moved billing to Go. Pivotal in that move.', { roles: at('Pivotal') })).toBe('refused');
  expect(profile('**Pivotal** in moving the billing service.', { roles: at('Pivotal') })).toBe('refused');
  expect(profile('Billing: Pivotal in that move.', { roles: at('Pivotal') })).toBe('refused');
  // Right after a word of its sentence, the capitalised name is the name.
  expect(profile('Moved the billing service to Go at Pivotal.', { roles: at('Pivotal') })).toBe('ready');
});

test('on a resume, Skills and Education lines are read for banned words; only names in them are excused', () => {
  const skillsProse = RESUME.replace('Go, Kafka, Postgres, Redis, Docker, Terraform', 'Results-driven leader who spearheaded robust, dynamic, cutting-edge platforms and fostered seamless teams');
  expect(check('resume', skillsProse, READY).verdict).toBe('refused');
  const education = check('resume', `${RESUME}\n## Education\nPassionate, results-driven learner who leveraged every course\n`, READY);
  expect(hitsOf(education, 'banned-word').map((h) => [h.found, h.line])).toEqual([['leveraged', 22], ['Passionate', 22], ['results-driven', 22]]);
  const named = `${RESUME.replace('Go, Kafka, Postgres, Redis, Docker, Terraform', 'Go, Kafka, Pivotal Tracker, Dynamic Yield')}\n## Education\nMBA, Foster School of Business\n`;
  expect(hitsOf(check('resume', named, READY), 'banned-word').map((h) => h.found)).toEqual(['Pivotal', 'Dynamic', 'Foster']);
  expect(result(check('resume', named, { ...READY, names: ['Pivotal Tracker', 'Dynamic Yield', 'Foster School of Business'] }), 'banned-word')).toEqual({ rule: 'banned-word', state: 'pass' });
});

// ---------- Lines the record supplies, and lines it does not ----------

test('banned words and invented numbers are refused on every line, also where the record’s lines stand', () => {
  const tampered: [string, string, number][] = [
    ['a contact line', RESUME.replace('avery@lindqvist.example · 555 0100', 'Results-driven leader who spearheaded 900 robust launches'), 2],
    ['the name line', RESUME.replace('# Avery Lindqvist', '# Avery Lindqvist, results-driven leader who spearheaded 900 robust launches'), 1],
    ['a dates line with a tail', RESUME.replace('Mar 2021 – Present · Remote', 'Mar 2021 – Present · Remote · Results-driven, spearheaded 900 robust launches'), 9],
    ['a Previously line with a tail', RESUME.replace('Previously Senior Engineer, Jan 2016 – Dec 2018', 'Previously Senior Engineer, Jan 2016 – Dec 2018 · results-driven, spearheaded 900 robust launches'), 15],
    ['a heading with a tail', RESUME.replace('### Director of Engineering, Harborlight Systems', '### Director of Engineering, Harborlight Systems (results-driven, spearheaded 900 robust launches)'), 8],
    ['a tagline over an email-only contact line', RESUME.replace('avery@lindqvist.example · 555 0100', 'Results-driven leader who spearheaded 900 robust launches\navery@lindqvist.example'), 2],
    ['an Earlier experience line with a tail', RESUME.replace('## Skills', '## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012), where I spearheaded 900 robust, results-driven launches\n\n## Skills'), 19],
  ];
  const roles = [...ROLES, role(4, 'Support Lead', 'Tessellate Freight', '2010-05', '2012-08')];
  for (const [what, text, line] of tampered) {
    const c = check('resume', text, { ...READY, roles });
    expect([what, c.verdict]).toEqual([what, 'refused']);
    expect([what, hitsOf(c, 'banned-word').map((h) => [h.word, h.line])]).toEqual([what, [['robust', line], ['spearheaded', line], ['results-driven', line]]]);
    expect([what, hitsOf(c, 'number-held-by-record').map((h) => [h.number, h.line])]).toEqual([what, [['900', line]]]);
  }
  // The same Earlier experience line without the tail is the record's own, and is not read.
  const earlier = RESUME.replace('## Skills', '## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012)\n\n## Skills');
  expect(check('resume', earlier, { ...READY, roles }).verdict).toBe('ready');
});

test('text that equals what the record supplies is not read; the same text the record does not hold is', () => {
  const withNote = RESUME.replace('Mar 2021 – Present · Remote\n', 'Mar 2021 – Present · Remote\nRan alongside the Quillfeather job, 20 hours a week.\n');
  // The role's note in the record holds the line: its 20 is the record's.
  const noted = ROLES.map((r) => (r.id === 1 ? { ...r, note: 'Ran alongside the Quillfeather job, 20 hours a week.' } : r));
  expect(result(check('resume', withNote, { ...READY, roles: noted }), 'number-held-by-record')).toEqual({ rule: 'number-held-by-record', state: 'pass' });
  // With no such note, the same line is written text, and 20 is nowhere in the record.
  expect(hitsOf(check('resume', withNote, READY), 'number-held-by-record').map((h) => h.number)).toEqual(['20']);
});

test('the name and contact parts are not read only when they equal what the record gives for the person', () => {
  const twoLines = RESUME.replace('avery@lindqvist.example · 555 0100', 'Duluth, MN\navery@lindqvist.example · 218 555 0142 · linkedin.com/in/avery-lindqvist');
  const person = { name: 'Avery Lindqvist', contact: ['Duluth, MN', 'avery@lindqvist.example', '218 555 0142', 'linkedin.com/in/avery-lindqvist'] };
  expect(check('resume', twoLines, { ...READY, person }).verdict).toBe('ready');
  // Without the person's parts the contact line is read like any other: its phone number is a number the facts lack.
  expect(hitsOf(check('resume', twoLines, { ...READY, person: undefined }), 'number-held-by-record').map((h) => h.number)).toEqual(['218', '555', '0142']);
  // A part shaped like a link is still read when the record does not give it.
  const smuggled = check('resume', RESUME.replace('avery@lindqvist.example · 555 0100', 'avery@lindqvist.example · robust.leader/900-launches'), READY);
  expect([smuggled.verdict, hitsOf(smuggled, 'banned-word').map((h) => h.found)]).toEqual(['refused', ['robust']]);
  const tagged = RESUME.replace('avery@lindqvist.example · 555 0100', 'avery@lindqvist.example · Suite 900, Dynamic Tower');
  expect(check('resume', tagged, READY).verdict).toBe('refused');
  expect(check('resume', tagged, { ...READY, person: { ...PERSON, contact: [...PERSON.contact, 'Suite 900, Dynamic Tower'] } }).verdict).toBe('ready');
});

// ---------- Limits ----------

test('line-length: a line of exactly the limit passes, one word more breaks; the limit is a parameter', () => {
  // A CARL bullet: 30 words on one page, 34 on two; with no page count, 34.
  expect([LIMITS.lineWords, LIMITS.onePageLineWords]).toEqual([34, 30]);
  const bullet = (n: number) => `# Avery Lindqvist\n\n## Experience\n### Staff Engineer, Quillfeather Labs\nJan 2019 – Feb 2021\n- Rebuilt ${words(n - 1)}\n`;
  expect(result(check('resume', bullet(34)), 'line-length')).toEqual({ rule: 'line-length', state: 'pass' });
  expect(hitsOf(check('resume', bullet(35)), 'line-length')).toEqual([{ line: 6, quote: `- Rebuilt ${words(34)}`, words: 35, limit: 34 }]);
  expect(result(check('resume', bullet(30), { pages: 1 }), 'line-length')?.state).toBe('pass');
  expect(hitsOf(check('resume', bullet(31), { pages: 1 }), 'line-length').map((h) => h.limit)).toEqual([30]);
  expect(result(check('resume', bullet(6), { limits: { lineWords: 6 } }), 'line-length')?.state).toBe('pass');
  expect(result(check('resume', bullet(7), { limits: { lineWords: 6 } }), 'line-length')?.state).toBe('break');
  // With EGG_CARL=off the limit is 28 on any length, as before CARL.
  process.env.EGG_CARL = 'off';
  try {
    expect(LIMITS.lineWords).toBe(28);
    expect(result(check('resume', bullet(28), { pages: 1 }), 'line-length')?.state).toBe('pass');
    expect(hitsOf(check('resume', bullet(29), { pages: 2 }), 'line-length').map((h) => h.limit)).toEqual([28]);
  } finally { delete process.env.EGG_CARL; }
});

test('the Summary is measured as a whole: 60 words and 3 sentences, as lib/checks.ts holds it', () => {
  expect([LIMITS.summaryWords, LIMITS.summarySentences]).toEqual([60, 3]);
  const summary = (text: string) => `# Avery Lindqvist\n\n## Summary\n${text}\n`;
  expect(result(check('resume', summary(`${words(59)}.`)), 'line-length')?.state).toBe('pass');
  expect(hitsOf(check('resume', summary(`${words(60)}\n${words(1)}.`)), 'line-length')).toEqual([{ line: 4, quote: words(60), words: 61, limit: 60, sentences: { count: 1, limit: 3 } }]);
  expect(result(check('resume', summary('Built one. Ran two. Led three.')), 'line-length')?.state).toBe('pass');
  expect(hitsOf(check('resume', summary('Built one. Ran two. Led three. Cut four.')), 'line-length').map((h) => h.sentences)).toEqual([{ count: 4, limit: 3 }]);
  expect(hitsOf(check('resume', summary(words(300))), 'line-length').map((h) => h.words)).toEqual([300]);
  expect(result(check('resume', summary(`${words(61)}.`), { limits: { summaryWords: 61 } }), 'line-length')?.state).toBe('pass');
});

test('line-length and technologies-per-line read every written line, wherever it is; not Skills', () => {
  const long = `Built ${words(60)} with Go, Kafka, Postgres, Redis, Docker and Terraform.`;
  const places: [string, string, number][] = [
    ['under Experience with no role heading', `# Avery Lindqvist\navery@lindqvist.example\n\n## Experience\n- ${long}\n`, 5],
    ['in a resume with no section at all', `# Avery Lindqvist\n- ${long}\n`, 2],
    ['in a section of its own', RESUME.replace('## Skills', `## Selected work\n- ${long}\n\n## Skills`), 19],
    ['as a bullet in the Summary', RESUME.replace('Engineer building logistics software in Go for depots and their schedulers.', `- ${long}`), 5],
    ['as a plain line under a role', RESUME.replace('- Lead a team of 6 engineers on Go and Kafka services.', long), 11],
    ['as the tail of a dates line', RESUME.replace('Mar 2021 – Present · Remote', `Mar 2021 – Present · Remote · ${long}`), 9],
    ['as the tail of an Earlier experience line', RESUME.replace('## Skills', `## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012), ${long}\n\n## Skills`), 19],
    ['as an Education line', `${RESUME}\n## Education\n${long}\n`, 22],
  ];
  for (const [where, text, line] of places) {
    const c = check('resume', text, { technologies: TECH, roles: [] });
    expect([where, hitsOf(c, 'line-length').map((h) => h.line), hitsOf(c, 'technologies-per-line').map((h) => h.line)]).toEqual([where, [line], [line]]);
  }
  // A Skills line, in a bullet or not, is a list of tools.
  const skills = check('resume', RESUME.replace('Go, Kafka, Postgres, Redis, Docker, Terraform', `- ${long}`), { technologies: TECH });
  expect([result(skills, 'line-length')?.state, result(skills, 'technologies-per-line')?.state]).toEqual(['pass', 'pass']);
});

test('document-length: the page limit at its boundary; no page count is not checked; a message at 75', () => {
  expect(LIMITS.resumeWords).toEqual({ 1: 650, 2: 1100 });
  expect(LIMITS.messageWords).toBe(75);
  // "# Avery Lindqvist" and "## Selected work" are 4 words once their marks are gone; the rest are bullets of 20 words or fewer, marked "*", which lib/ats.ts (draftScore) does not count as a word.
  const resume = (n: number) => {
    const bullets: string[] = [];
    for (let left = n - 4; left > 0; left -= 20) bullets.push(`* ${words(Math.min(20, left))}`);
    return `# Avery Lindqvist\n\n## Selected work\n${bullets.join('\n')}\n`;
  };
  expect(result(check('resume', resume(650), { pages: 1 }), 'document-length')).toEqual({ rule: 'document-length', state: 'pass' });
  expect(result(check('resume', resume(651), { pages: 1 }), 'document-length')).toEqual({ rule: 'document-length', state: 'break', hits: [{ words: 651, limit: 650 }] });
  expect(result(check('resume', resume(1100), { pages: 2 }), 'document-length')?.state).toBe('pass');
  expect(result(check('resume', resume(1101), { pages: 2 }), 'document-length')?.state).toBe('break');
  // A two-page resume is not held to one page because nobody said how many pages it has.
  expect(result(check('resume', resume(876)), 'document-length')).toEqual({ rule: 'document-length', state: 'not-checked', why: 'The resume’s number of pages was not given.' });
  expect(result(check('message', words(75)), 'document-length')?.state).toBe('pass');
  expect(result(check('message', words(76)), 'document-length')?.state).toBe('break');
  expect(result(check('message', words(40), { limits: { documentWords: 40 } }), 'document-length')?.state).toBe('pass');
  expect(result(check('message', words(41), { limits: { documentWords: 40 } }), 'document-length')?.state).toBe('break');
  expect(limitsFor('resume', { pages: 2, limits: { lineWords: 20 } })).toEqual({ lineWords: 20, technologiesPerLine: 4, documentWords: 1100, summaryWords: 60, summarySentences: 3 });
  expect(limitsFor('profile').documentWords).toBeNull();
});

test('a limit that is not a whole number above 0 is thrown, never used', () => {
  for (const bad of [NaN, 0, -1, 2.5, Infinity]) {
    expect(() => check('message', words(500), { limits: { documentWords: bad } })).toThrow('must be a whole number above 0');
    expect(() => check('resume', RESUME, { limits: { lineWords: bad } })).toThrow('must be a whole number above 0');
    expect(() => check('resume', RESUME, { limits: { summaryWords: bad } })).toThrow('must be a whole number above 0');
  }
  expect(() => check('resume', RESUME, { pages: 3 as 1 })).toThrow('1 or 2 pages');
});

test('technologies-per-line: four names in a line pass, five break; names count once and short names only as tokens', () => {
  expect(LIMITS.technologiesPerLine).toBe(4);
  const bullet = (text: string) => `# Avery Lindqvist\n\n## Experience\n### Staff Engineer, Quillfeather Labs\nJan 2019 – Feb 2021\n- ${text}\n`;
  const tech = (text: string, limits?: Context['limits']) => result(check('resume', bullet(text), { technologies: TECH, limits }), 'technologies-per-line');
  expect(tech('Rebuilt the quoting API in Go with Kafka, Postgres and Redis.')).toEqual({ rule: 'technologies-per-line', state: 'pass' });
  expect(tech('Rebuilt the quoting API in Go with Kafka, Postgres, Redis and Docker.')).toEqual({ rule: 'technologies-per-line', state: 'break',
    hits: [{ line: 6, quote: '- Rebuilt the quoting API in Go with Kafka, Postgres, Redis and Docker.', technologies: ['Go', 'Kafka', 'Postgres', 'Redis', 'Docker'], limit: 4 }] });
  expect(tech('Rebuilt the quoting API in Go with Kafka, Postgres, Redis and Docker.', { technologiesPerLine: 5 })?.state).toBe('pass');
  expect(tech('Built React Native apps with Kafka, Redis and Docker.')?.state).toBe('pass');
  expect(tech('Built React Native and React apps with Kafka, Redis and Docker.')?.state).toBe('break');
  // "Go", "R" and "C" count only as tokens of their own: not "go live", "Go-to-market", "R&D", "C-suite" or "C++".
  expect(tech('Wrote the Go-to-market plan for R&D and the C-suite on Kafka, Redis, Docker and Postgres; it went to go live in C++.')?.state).toBe('pass');
  expect(tech('Ported models from R and C to Go on Kafka and Redis.')?.state).toBe('break');
  expect(result(check('resume', bullet('Rebuilt the API.')), 'technologies-per-line')).toEqual({ rule: 'technologies-per-line', state: 'not-checked', why: 'No list of technologies was given.' });
});

// ---------- Rule 5, wrapped ----------

test('role-heading-as-given wraps the facts check of lib/entries.ts, and takes a role’s dates only as the record has them', () => {
  expect(result(check('resume', RESUME, { roles: ROLES }), 'role-heading-as-given')).toEqual({ rule: 'role-heading-as-given', state: 'pass' });
  const title = hitsOf(check('resume', RESUME.replace('### Director of Engineering, Harborlight Systems', '### VP of Engineering, Harborlight Systems'), { roles: ROLES }), 'role-heading-as-given');
  expect(title.map((h) => [h.kind, h.was])).toEqual([['title', 'VP of Engineering']]);
  expect(hitsOf(check('resume', RESUME.replace('Jan 2019 – Feb 2021', 'Jan 2018 – Feb 2021'), { roles: ROLES }), 'role-heading-as-given').map((h) => h.kind)).toEqual(['dates']);
  expect(result(check('resume', RESUME), 'role-heading-as-given')?.state).toBe('not-checked');
  // The same dates with a hyphen in place of the dash are the record's dates: ready.
  expect(check('resume', RESUME.replace('Jan 2019 – Feb 2021', 'Jan 2019 - Feb 2021'), READY).verdict).toBe('ready');
  // lib/entries.ts compares no dates for an employer the record holds without dates: a range there is no record's.
  const undated = ROLES.map((r) => (r.id === 1 ? { ...r, start: '', end: '' } : r));
  expect([result(check('resume', RESUME, { ...READY, roles: undated }), 'role-heading-as-given')?.state, check('resume', RESUME, { ...READY, roles: undated }).verdict]).toEqual(['pass', 'unverified']);
});

test('a line with dates that is no part of a role entry breaks rule 5; under Education it leaves it not checked', () => {
  const cto = 'CTO, Invented Corp, Jan 2010 – Dec 2015';
  for (const [where, text] of [['under Leadership', RESUME.replace('## Skills', `## Leadership\n${cto}\n\n## Skills`)], ['in the Summary', RESUME.replace('for depots and their schedulers.', `for depots and their schedulers. ${cto}.`)]]) {
    const c = check('resume', text, READY);
    expect([where, c.verdict, hitsOf(c, 'role-heading-as-given').map((h) => h.entry.includes(cto))]).toEqual([where, 'refused', [true]]);
  }
  // A degree or a certificate the record does not supply cannot be judged: not checked, so never ready.
  const degree = check('resume', `${RESUME}\n## Education\nPh.D. Physics, Invented University\n`, READY);
  expect([degree.verdict, result(degree, 'role-heading-as-given')?.state]).toEqual(['unverified', 'not-checked']);
  expect(check('resume', `${RESUME}\n## Certifications\nInvented Cloud Architect, 2019 – 2022\n`, READY).verdict).toBe('unverified');
  // The record's own Education line is not read: ready. Without the record's lines it cannot be.
  expect(check('resume', `${RESUME}\n## Education\n${EDUCATION}\n`, READY).verdict).toBe('ready');
  expect(check('resume', `${RESUME}\n## Education\n${EDUCATION}\n`, { ...READY, education: undefined }).verdict).toBe('unverified');
});

// ---------- Rule 6, wrapped ----------

test('number-held-by-record: against the whole record a number can break, never pass', () => {
  const profile = (text: string) => result(check('profile', text, { record: RECORD }), 'number-held-by-record');
  expect(profile('The console serves 900 users.')).toEqual({ rule: 'number-held-by-record', state: 'break', hits: [{ line: 1, quote: 'The console serves 900 users.', number: '900' }] });
  expect(profile('Closed 4,000 tickets and wrote 9,000 tests.')?.state).toBe('break');
  // The value is in the record, as something else ("12 depots"): never a pass.
  expect(profile('Cut costs by 12%.')?.state).toBe('not-checked');
  expect(profile('Built the dispatch console that 640 users open.')?.state).toBe('not-checked');
  // A number word, a count of years: not judged, so not a pass, and no refusal of honest text.
  expect(profile('I have worked at three companies and led two teams.')?.state).toBe('not-checked');
  expect(profile('Engineer with 25 years of experience.')?.state).toBe('not-checked');
  // A date with no cited fact to compare it with is not judged.
  expect(profile('Shipped the console in March 2021.')?.state).toBe('not-checked');
  expect(profile('Built the dispatch console.')).toEqual({ rule: 'number-held-by-record', state: 'pass' });
  expect(result(check('profile', 'It serves 640 users.'), 'number-held-by-record')?.state).toBe('not-checked');
});

test('number-held-by-record: a line checked against the facts it cites can pass, and breaks on any count they do not hold', () => {
  const cites = new Map([['Cut costs by 12%.', 'Cut hosting costs by 12%.'], ['Served 640 users.', 'Rebuilt the quoting API.']]);
  const c = (text: string) => result(check('profile', text, { record: { ...RECORD, cites } }), 'number-held-by-record');
  expect(c('Cut costs by 12%.')).toEqual({ rule: 'number-held-by-record', state: 'pass' });
  // 640 is in the record, but not in the facts this line cites.
  expect(c('Served 640 users.')).toEqual({ rule: 'number-held-by-record', state: 'break', hits: [{ line: 1, quote: 'Served 640 users.', number: '640' }] });
  expect(c('1. Built the dispatch console.\n2) Rebuilt the quoting API.')).toEqual({ rule: 'number-held-by-record', state: 'pass' });
  // Invented counts of tickets, tests and coverage break on a cited line too; the count of years stays not judged.
  const line = 'Closed 4,000 tickets and wrote 9,000 tests with 95% coverage over 25 years.';
  const cited = check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- ${line}`), citing(line, 'Rebuilt the quoting API.'));
  expect([cited.verdict, hitsOf(cited, 'number-held-by-record').map((h) => h.number)]).toEqual(['refused', ['4,000', '9,000', '95%']]);
  const years = 'Rebuilt the quoting API in Go over 25 years.';
  expect(result(check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- ${years}`), citing(years, 'Rebuilt the quoting API.')), 'number-held-by-record')?.state).toBe('not-checked');
});

test('number-held-by-record: with cited facts, a number passes only on the same value counting the same thing', () => {
  // A year in a bullet: the year the line names is the break; another month is not confirmed; the same date passes.
  const march = 'Rebuilt the quoting API in Go in March 2017.';
  const resume = RESUME.replace('- Rebuilt the quoting API in Go.', `- ${march}`);
  expect(hitsOf(check('resume', resume, citing(march, 'Rebuilt the quoting API in Go in March 2020.')), 'number-held-by-record').map((h) => h.number)).toEqual(['2017']);
  expect(check('resume', resume, citing(march, 'Rebuilt the quoting API in Go in June 2017.')).verdict).toBe('unverified');
  expect(check('resume', resume, citing(march, 'Rebuilt the quoting API in Go in March 2017.')).verdict).toBe('ready');
  const profile = (text: string, fact: string) => check('profile', text, { record: { ...RECORD, cites: new Map([[text, fact]]) } }).verdict;
  // A percent is part of the value; the words before a number must all stand before the cited one; no words, no pass.
  expect(profile('Cut costs by 12%.', 'Cut costs by 12.')).toBe('unverified');
  expect(profile('Costs grew by 40%.', 'Revenue grew 40%.')).toBe('unverified');
  expect(profile('12% of costs.', 'Cut hosting costs by 12% of costs.')).toBe('unverified');
  expect(profile('Led 2 teams.', 'Led two teams.')).toBe('ready');
  // A quantity in words passes only when a cited fact uses the same word about the same thing; a count of years never.
  expect([profile('Tripled revenue.', 'Grew revenue across 12 depots.'), profile('Doubled the depots.', 'Grew revenue across 12 depots.')]).toEqual(['unverified', 'unverified']);
  expect(profile('Tripled revenue.', 'Tripled revenue in two years.')).toBe('ready');
  for (const [text, fact] of [['Cut the deploy to one hour.', 'Cut the deploy to two hours.'], ['Grew revenue ten-fold.', 'Grew revenue.'], ['Cut costs by two-thirds.', 'Cut costs.'], ['Engineer with fifteen years in logistics.', 'Engineer with fifteen years in logistics.']]) {
    expect([text, profile(text, fact)]).toEqual([text, 'unverified']);
  }
});

test('digits that are no number leave a line not checked, unless the cited facts hold the same code', () => {
  const line = 'Cut p95 latency of the quoting API to 210ms.';
  const resume = RESUME.replace('- Rebuilt the quoting API in Go.', `- ${line}`);
  expect(result(check('resume', resume, citing(line, 'Cut quoting API latency to 210ms.')), 'number-held-by-record')?.state).toBe('not-checked');
  expect(check('resume', resume, citing(line, 'Cut p95 latency of the quoting API to 210ms.')).verdict).toBe('ready');
  // A code with no letter ("SOC 2") is never confirmed, even when the cited fact holds it.
  const soc = 'Passed the SOC 2 audit for the quoting API.';
  expect(check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- ${soc}`), citing(soc, soc)).verdict).toBe('unverified');
  // A name of the record that holds a digit is the record's text.
  const dyn = 'Moved the quoting API to Dynamics 365.';
  expect(check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- ${dyn}`), { ...READY, technologies: [...TECH, 'Dynamics 365'] }).verdict).toBe('ready');
  expect(check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- ${dyn}`), READY).verdict).toBe('refused');
});

test('a Markdown link is read by its text; digits in its address leave the number rule not checked', () => {
  const link = '[LinkedIn](https://linkedin.example/in/avery-4512)';
  const linked = RESUME.replace('avery@lindqvist.example · 555 0100', `avery@lindqvist.example · 555 0100 · ${link}`);
  const c = check('resume', linked, READY);
  expect([c.verdict, result(c, 'banned-word')?.state, result(c, 'number-held-by-record')?.state]).toEqual(['unverified', 'pass', 'not-checked']);
  expect(check('resume', linked, { ...READY, person: { ...PERSON, contact: [...PERSON.contact, link] } }).verdict).toBe('ready');
  expect(check('resume', linked.replace('[LinkedIn]', '[Robust leader]'), READY).verdict).toBe('refused');
});

test('an honest resume and an honest profile are ready with the whole context', () => {
  expect(check('resume', `${RESUME}\n## Education\n${EDUCATION}\n`, READY).verdict).toBe('ready');
  const profile = 'I build logistics software in Go for depots and their schedulers.\nThe dispatch console I built is opened by 640 users across 12 depots every day.\nI lead a team of 6 engineers.';
  const cites = new Map([['The dispatch console I built is opened by 640 users across 12 depots every day.', 'Built the dispatch console. 640 users across 12 depots open it every day.'], ['I lead a team of 6 engineers.', 'Led a team of 6 engineers.']]);
  expect(check('profile', profile, { ...READY, record: { ...RECORD, cites } }).verdict).toBe('ready');
  // The keys are lib/links.ts's (places): each bullet by its text, and the Summary as one line, its lines joined.
  const companies = ROLES.map((r) => r.company);
  expect([...CITES.keys()].every((k) => places(RESUME, companies).places.some((p) => p.where === 'bullet' && p.text === k))).toBe(true);
  const summary = 'Engineer building logistics software in Go for depots and their schedulers.\nLead a team of 6 engineers.';
  const two = RESUME.replace('Engineer building logistics software in Go for depots and their schedulers.', summary);
  const facts = new Map([...CITES, [summary.replace('\n', ' '), 'Led a team of 6 engineers.']]);
  const keyed = new Map(places(two, companies).places.map((p) => [p.text, facts.get(p.text) ?? 'Rebuilt the quoting API.']));
  expect(keyed.has(summary.replace('\n', ' '))).toBe(true);
  expect(check('resume', two, READY).verdict).toBe('unverified');
  expect(check('resume', two, { ...READY, record: { ...RECORD, cites: keyed } }).verdict).toBe('ready');
});

// ---------- The cases that once read ready ----------

// Each of these returned "ready" in an earlier review. Each must now be refused or unverified.
const CTO = 'CTO, Invented Corp, Jan 2010 – Dec 2015';
const MARCH = 'Rebuilt the quoting API in Go in March 2017.';
const asBullet = (line: string) => RESUME.replace('- Rebuilt the quoting API in Go.', `- ${line}`);
const citedTo = (text: string, fact: string): Context => ({ record: { ...RECORD, cites: new Map([[text, fact]]) } });
const SCENARIOS: [string, Surface, string, Context, Verdict][] = [
  ['a dated line in Experience', 'resume', RESUME.replace('## Experience\n', `## Experience\n${CTO}\n`), READY, 'refused'],
  ['the same line right after a role’s bullet', 'resume', RESUME.replace('- Rebuilt the quoting API in Go.', `- Rebuilt the quoting API in Go.\n${CTO}`), READY, 'refused'],
  ['a similar line under Leadership', 'resume', RESUME.replace('## Skills', `## Leadership\nVP, Invented Corp, 2008 – 2010\n\n## Skills`), READY, 'refused'],
  ['an invented degree under Education', 'resume', `${RESUME}\n## Education\nM.S. Computer Science, Invented University, 2010 – 2012\n`, READY, 'unverified'],
  ['the employer “Crucial” opening a bullet', 'resume', asBullet('Crucial in moving the billing service to Go.'), { ...READY, roles: [...ROLES, role(5, 'Engineer', 'Crucial', '2012-01', '2015-12')] }, 'refused'],
  ['the employer “Pivotal” opening a profile', 'profile', 'Pivotal in moving the billing service to Go.', { record: RECORD, roles: [role(7, 'Staff Engineer', 'Pivotal', '2019-01', '2021-02')] }, 'refused'],
  ['the name “Foster” opening a line', 'profile', 'Foster trust with depots.', { record: RECORD, names: ['Foster'] }, 'refused'],
  ['the technology “Dynamic” opening a line', 'profile', 'Dynamic leader of logistics teams.', { record: RECORD, technologies: ['Dynamic'] }, 'refused'],
  ['a year in a bullet against a cited 2020', 'resume', asBullet(MARCH), citing(MARCH, 'Rebuilt the quoting API in Go in 2020.'), 'refused'],
  ['a year in a bullet with no cited fact', 'resume', asBullet(MARCH), READY, 'unverified'],
  ['“12%” cited to “12 depots”', 'profile', 'Cut costs by 12%.', citedTo('Cut costs by 12%.', '640 users across 12 depots.'), 'unverified'],
  ['“6 months” cited to “6 engineers”', 'profile', 'Shipped it in 6 months.', citedTo('Shipped it in 6 months.', 'Led a team of 6 engineers.'), 'unverified'],
  ['“Tripled” with no cited fact that says so', 'profile', 'Tripled revenue.', { record: RECORD }, 'unverified'],
  ['“Doubled” with no cited fact that says so', 'profile', 'Doubled the depots.', { record: RECORD }, 'unverified'],
  ['a banned word, whatever else the context holds', 'profile', 'Built a robust system.', { ...READY, names: ['Robust Systems Group'], roles: [role(8, 'Engineer', 'Robust', '2010-01', '2011-01')] }, 'refused'],
];
for (const [name, surface, text, context, verdict] of SCENARIOS) test(`once ready, now ${verdict}: ${name}`, () => expect(check(surface, text, context).verdict).toBe(verdict));

test('on a message and an answer the number rule is never passed: a claims rule for them does not exist yet', () => {
  for (const surface of ['message', 'answer'] as const) {
    const c = check(surface, 'I grew revenue 900% and led 5,000 engineers.', { record: RECORD });
    expect([surface, c.verdict]).toEqual([surface, 'unverified']);
    const r = result(c, 'number-held-by-record');
    expect([surface, r?.state, r?.state === 'not-checked' && /No rule exists yet for the claims/.test(r.why)]).toEqual([surface, 'not-checked', true]);
  }
});

test('the record is read once per call, not once per line', () => {
  const stated = Array.from({ length: 4000 }, (_, i) => `Built service ${i} used by ${i * 7} users across ${i % 40} depots in 2021, saving ${i}k dollars.`).join(' ');
  const resume = RESUME.replace('- Rebuilt the quoting API in Go.', Array.from({ length: 50 }, (_, i) => `- Rebuilt part ${i} of the quoting API in Go for ${i * 7} users.`).join('\n'));
  const t = performance.now();
  check('resume', resume, { ...READY, record: { stated }, names: Array.from({ length: 2000 }, (_, i) => `Name Number${i} Corp`) });
  // It took 3.6 seconds when every line read the whole record again.
  expect(performance.now() - t).toBeLessThan(1500);
});

// ---------- The verdict ----------

test('ready needs every rule that applies to pass; a rule not checked never makes a text ready', () => {
  expect(check('resume', RESUME, READY).verdict).toBe('ready');
  const without: [string, Context][] = [
    ['no file results', { ...READY, file: undefined }],
    ['one file result', { ...READY, file: { 'single-column-file': { ok: true } } }],
    ['no page count', { ...READY, pages: undefined }],
    ['no cited facts', { ...READY, record: RECORD }],
    ['no roles', { ...READY, roles: undefined }],
    ['no technologies', { ...READY, technologies: undefined }],
  ];
  for (const [what, context] of without) expect([what, check('resume', RESUME, context).verdict]).toEqual([what, 'unverified']);
  // A count of years in the Summary is not judged yet, so such a resume is not ready.
  expect(check('resume', RESUME.replace('Engineer building', 'Engineer with 14 years building'), READY).verdict).toBe('unverified');
  expect(check('resume', RESUME.replace('Build the', 'Spearheaded the')).verdict).toBe('refused');
  const badFile = check('resume', RESUME, { ...READY, file: { ...FILE_OK, 'parser-reads-record': { ok: false, problems: [] } } });
  expect([badFile.verdict, hitsOf(badFile, 'parser-reads-record')]).toEqual(['refused', [{ problem: 'The check of the file failed.' }]]);
  expect(verdictOf([])).toBe('unverified');
  expect(verdictOf([{ rule: 'banned-word', state: 'pass' }, { rule: 'line-length', state: 'not-checked', why: 'x' }])).toBe('unverified');
  expect(verdictOf([{ rule: 'banned-word', state: 'pass' }])).toBe('ready');
});

test('a text with no word is never ready', () => {
  for (const surface of SURFACES) for (const text of ['', '   \n  \n', '.', '- \n# \n---']) {
    const c = check(surface, text, READY);
    expect([surface, text, c.verdict, c.exact.every((r) => r.state === 'not-checked')]).toEqual([surface, text, 'unverified', true]);
  }
});

test('the checklist never changes the verdict or an exact rule', () => {
  const plain = check('resume', RESUME, READY);
  const measured = check('resume', RESUME, { ...READY, posting: { terms: ['Kubernetes', 'Kafka'], supported: [] }, strongest: ['Rebuilt the quoting API in Go.'] });
  expect(item(measured, 'echoes-posting')).toMatchObject({ state: 'measured', terms: [{ term: 'Kafka' }] });
  expect(measured.exact).toEqual(plain.exact);
  expect(measured.verdict).toBe('ready');
});

// ---------- Each surface ----------

test('each surface has exactly the rules the table gives it', () => {
  const expected: Record<Surface, ExactRule[]> = {
    resume: [...EXACT_RULES],
    profile: ['banned-word', 'number-held-by-record'],
    message: ['banned-word', 'document-length', 'number-held-by-record'],
    answer: ['banned-word', 'number-held-by-record'],
  };
  for (const surface of SURFACES) {
    const c = check(surface, 'Plain text with no number.', READY);
    expect([surface, c.exact.map((r) => r.rule)]).toEqual([surface, expected[surface]]);
    expect([surface, EXACT_RULES.filter((r) => (APPLIES[r] as readonly Surface[]).includes(surface))]).toEqual([surface, expected[surface]]);
    expect(c.checklist.map((x) => x.rule)).toEqual([...CHECKLIST_RULES]);
  }
  expect(check('profile', 'Built the dispatch console.', { record: RECORD }).verdict).toBe('ready');
  for (const surface of ['message', 'answer'] as const) expect([surface, check(surface, 'Built the dispatch console.', { record: RECORD }).verdict]).toEqual([surface, 'unverified']);
  for (const surface of SURFACES) expect([surface, check(surface, 'Built a robust dispatch console.', READY).verdict]).toEqual([surface, 'refused']);
});

// ---------- What a writer is told ----------

test('a refused writer is told each broken rule with its exact words, and nothing from the checklist', () => {
  const c = check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', '- Rebuilt the quoting API in a dynamic way for 900 users.'), { ...READY, posting: { terms: ['Kubernetes'], supported: [] } });
  expect(c.verdict).toBe('refused');
  expect(retryNote(c)).toBe([
    '- Line 16 uses “dynamic”, a word that is never used. Say what was done in plain words. The line: “- Rebuilt the quoting API in a dynamic way for 900 users.”',
    '- Line 16 uses “900”, which no fact it may draw on holds. Take the number out, or say only what the cited fact says. The line: “- Rebuilt the quoting API in a dynamic way for 900 users.”',
  ].join('\n'));
  expect(retryNote(check('resume', RESUME.replace('Engineer building', `Engineer ${words(70)} building`), READY))).toBe('- The Summary has 81 words in 1 sentence. The most is 60 words in 3 sentences.');
  expect(retryNote(check('resume', RESUME, { ...READY, file: undefined }))).toBe('');
  expect(retryNote(check('resume', RESUME, READY))).toBe('');
});

// ---------- Checklist ----------

test('bullets-alike measures word counts and openers per role, with no verdict', () => {
  expect(item(check('resume', RESUME), 'bullets-alike')).toEqual({ rule: 'bullets-alike', state: 'measured', roles: [
    { role: 'Director of Engineering, Harborlight Systems', bullets: 2, words: { fewest: 11, most: 13, mean: 12, spread: 1 }, opener: { word: 'build', share: 0.5 } },
    { role: 'Staff Engineer, Quillfeather Labs', bullets: 1, words: { fewest: 6, most: 6, mean: 6, spread: 0 }, opener: { word: 'rebuilt', share: 1 } },
  ] });
  const same = check('resume', '# Avery Lindqvist\n\n## Experience\n### Staff Engineer, Quillfeather Labs\nJan 2019 – Feb 2021\n- Built one thing.\n- Built two more things here.\n- Cut the rest.\n');
  expect(item(same, 'bullets-alike')).toMatchObject({ state: 'measured', roles: [{ opener: { word: 'built', share: 0.67 }, words: { fewest: 3, most: 5 } }] });
  expect(item(check('message', 'Hi Rowan.'), 'bullets-alike').state).toBe('not-measured');
});

test('number-has-context lists the lines that hold a number, for the owner to read', () => {
  expect(item(check('resume', RESUME), 'number-has-context')).toEqual({ rule: 'number-has-context', state: 'measured', lines: [
    { line: 10, quote: '- Build the dispatch console that 640 users across 12 depots open every day.', numbers: ['640', '12'] },
    { line: 11, quote: '- Lead a team of 6 engineers on Go and Kafka services.', numbers: ['6'] },
  ] });
  expect(item(check('message', 'Hi Rowan.\nMy console serves 640 users.'), 'number-has-context')).toEqual({ rule: 'number-has-context', state: 'measured', lines: [{ line: 2, quote: 'My console serves 640 users.', numbers: ['640'] }] });
});

test('names-something-askable lists lines with no technology and no number; without a list of technologies it is not measured', () => {
  const c = check('resume', RESUME.replace('- Rebuilt the quoting API in Go.', '- Rebuilt the quoting API.'), { technologies: TECH });
  expect(item(c, 'names-something-askable')).toEqual({ rule: 'names-something-askable', state: 'measured', lines: [{ line: 16, quote: '- Rebuilt the quoting API.' }] });
  expect(item(check('resume', RESUME), 'names-something-askable')).toEqual({ rule: 'names-something-askable', state: 'not-measured', why: 'No list of technologies was given.' });
});

test('scope-is-own-part is on the checklist for the owner to judge, with no measurement', () => {
  for (const surface of SURFACES) expect(item(check(surface, RESUME), 'scope-is-own-part')).toEqual({ rule: 'scope-is-own-part', state: 'owner-judges' });
});

test('echoes-posting lists posting terms in the text that the record does not support; without them it is not measured', () => {
  const posting = { terms: ['Kafka', 'Kubernetes', 'Go'], supported: ['go', 'Postgres'] };
  const line = '- Lead a team of 6 engineers on Go, Kubernetes and Kafka services.';
  expect(item(check('resume', RESUME.replace('on Go and Kafka services', 'on Go, Kubernetes and Kafka services'), { posting }), 'echoes-posting'))
    .toEqual({ rule: 'echoes-posting', state: 'measured', terms: [{ line: 11, quote: line, term: 'Kubernetes' }, { line: 11, quote: line, term: 'Kafka' }] });
  expect(item(check('message', 'I build AI tools.', { posting: { terms: ['ai'], supported: [] } }), 'echoes-posting')).toEqual({ rule: 'echoes-posting', state: 'measured', terms: [{ line: 1, quote: 'I build AI tools.', term: 'ai' }] });
  expect(item(check('resume', RESUME), 'echoes-posting')).toEqual({ rule: 'echoes-posting', state: 'not-measured', why: 'The posting’s terms and the terms the record supports were not given.' });
});

test('strongest-first measures each role against the caller’s ranking; without one it is not measured', () => {
  const strongest = ['Lead a team of 6 engineers on Go and Kafka services.', 'Build the dispatch console that 640 users across 12 depots open every day.', 'Rebuilt the quoting API in Go.'];
  expect(item(check('resume', RESUME, { strongest }), 'strongest-first')).toEqual({ rule: 'strongest-first', state: 'measured', roles: [
    { role: 'Director of Engineering, Harborlight Systems', ranked: 2, firstIsStrongest: false, outOfOrder: 1 },
    { role: 'Staff Engineer, Quillfeather Labs', ranked: 1, firstIsStrongest: true, outOfOrder: 0 },
  ] });
  expect(item(check('resume', RESUME), 'strongest-first').state).toBe('not-measured');
});
