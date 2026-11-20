// `bun test lib`: the spoken story (lib/spoken.ts). The model is a stand-in (fakeAsk): no model is ever asked. What it
// proves: what the model is given; a text is refused whole, never repaired, for a number not said, its length or a
// line that looks like a heading; a number the owner typed into a part passes; the owner's edit or clearing is never
// overwritten until they choose to replace it; a failure changes nothing and can be tried again; and the time a text
// takes to say. Everything is invented.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, seed } from './scratch.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { activity } from './activity.ts';
import { advance, answerTurn, startSitting, turnsOf } from './sittings.ts';
import { AIM_SECONDS, DERIVING, HELD, askSpoken, checkSpoken, headingLine, runSpoken, saidAbout, saveSpoken, spokenSeconds, timeLine, timeWords, wordCount } from './spoken.ts';
import { checkDerived } from './derive.ts';

const now = 1_800_000_000_000;
let project = 0, bare = 0;
const ok = <T extends { ok: boolean }>(d: T) => { if (!d.ok) throw new Error(JSON.stringify(d)); return d as Extract<T, { ok: true }>; };
function tell(p: number, answers: string[]) {
  const id = ok(startSitting(p, now)).id;
  ok(advance(id, now));
  for (const a of answers) ok(answerTurn(id, turnsOf(id).at(-1)!.id, a, now));
  ok(advance(id, now, { stop: true }));
}
const SAID = ['The schedulers planned 35 depots on paper every Sunday night, and it was a mess, honestly.', 'I wrote the scheduler myself in TypeScript and moved the depots over one by one.'];
const GOOD = 'The schedulers planned 35 depots on paper every Sunday night.\n\nI wrote the scheduler myself in TypeScript. I moved the depots over one by one.\n\nI learned to move one depot at a time.';
const row = (p = project) => db.query('SELECT spoken, spoken_wrote, spoken_status, spoken_note FROM projects WHERE id = ?').get(p) as { spoken: string; spoken_wrote: string; spoken_status: string; spoken_note: string };
// Asks for the story and runs the worker's step with the stand-in's text.
async function write(text: string, replace = false) {
  expect(askSpoken(project, replace)).toBe('');
  fakeAsk(() => ({ spoken: text }));
  expect(await runSpoken('.')).toBe(true);
}

beforeEach(() => {
  seed();
  project = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Depot rota console', 1) RETURNING id").get() as { id: number }).id;
  bare = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (2, 'Quoting rebuild', 1) RETURNING id").get() as { id: number }).id;
  tell(project, SAID);
  db.run("UPDATE projects SET derive_status = '', derive_note = ''");
});
afterEach(() => fakeAsk());

test('what the model is given: the job, the project, its parts and facts as they stand, every answer word for word, and the rules', async () => {
  db.query("UPDATE projects SET result = 'Sunday planning stopped.' WHERE id = ?").run(project);
  db.query("INSERT INTO facts (role_id, project_id, kind, text, metric, created_at) VALUES (1, ?, 'accomplishment', 'Moved every depot off paper.', '35 depots', 1)").run(project);
  const asked: Ask[] = [];
  fakeAsk((call) => { asked.push(call); return { spoken: GOOD }; });
  expect(askSpoken(project)).toBe('');
  process.env.EGG_SPOKEN_MODEL = 'haiku';
  try { await runSpoken('.'); } finally { delete process.env.EGG_SPOKEN_MODEL; }
  expect(asked.length).toBe(1);
  expect(asked[0].model).toBe('haiku');
  const p = asked[0].prompt;
  expect(p).toContain('The job, for context only: Director of Engineering at Harborlight Systems, 2021-03 to now.');
  expect(p).toContain('The piece of work: Depot rota console.');
  expect(p).toContain('"result":"Sunday planning stopped."');
  expect(p).toContain('"text":"Moved every depot off paper.","detail":"","metric":"35 depots"');
  for (const a of SAID) expect(p).toContain(JSON.stringify(a));
  expect(p).toContain('first person, past tense, plain spoken sentences');
  expect(p).toContain('the context in two or three sentences; what they themselves did and decided, which is the longest part; the result; and what they learned, in one or two sentences.');
  expect(p).toContain('No headings, no lists and no labels.');
  expect(p).toContain('Never invent, round up or infer a number, a name, a date, a tool or an outcome.');
  expect(p).toContain('Write each number in the form the person gave it');
  expect(p).toContain('Where their answers have a plain, vivid phrase of their own, use it.');
  expect(p).toContain('a closing line about what a good fit they are');
  expect(p).toContain('at most 450 words');
  expect(p).toContain('A spoken story may use "I" and "we"');
  expect(p).toContain('Plain words. Never:');
});

test('the happy path: the text is stored as the writer’s, and Activity says it is done with a link to the story', async () => {
  await write(GOOD);
  expect(row()).toEqual({ spoken: GOOD, spoken_wrote: GOOD, spoken_status: 'done', spoken_note: '' });
  expect(activity(Date.now()).done.find((i) => i.kind === 'write-spoken')).toMatchObject({ subject: String(project), link: `/record/stories/${project}`, what: `Writing the spoken story P-${String(project).padStart(3, '0')}, Depot rota console` });
});

test('it is refused in words with nothing to tell, and while it is being written', () => {
  expect(askSpoken(bare)).toBe('There is nothing to tell yet. Tell this project, or write its four parts, first.');
  db.query("UPDATE projects SET context = 'Quotes took a day.' WHERE id = ?").run(bare);
  expect(askSpoken(bare)).toBe('');
  expect(askSpoken(bare)).toBe('The spoken story is being written now.');
  expect(askSpoken(99999)).toBe('That project is no longer in your record.');
});

test('a number not said is refused whole, twice, nothing is stored, and the Activity row says why', async () => {
  await write(`${GOOD}\n\nPlanning time fell by 80%.`);
  const why = 'The spoken story was not kept. It held a number you did not say: “80%”.';
  expect(row()).toEqual({ spoken: '', spoken_wrote: '', spoken_status: 'failed', spoken_note: why });
  expect(activity(Date.now()).items.find((i) => i.kind === 'write-spoken')).toMatchObject({ status: 'failed', reason: why });
  // A number word is held to the same form: "thirty-five" was never said.
  expect(checkSpoken('We had thirty-five depots on paper.', saidAbout(project))).toEqual({ ok: false, why: 'It held numbers you did not say: “thirty” and “five”.' });
});

test('a refused text is asked for once more with the reason, and the second text is kept', async () => {
  const asked: Ask[] = [], stages: string[] = [];
  fakeAsk((call) => {
    asked.push(call);
    stages.push((activity(Date.now()).items.find((i) => i.kind === 'write-spoken')?.stage) ?? '');
    return { spoken: asked.length === 1 ? `## Context\n${GOOD}` : GOOD };
  });
  expect(askSpoken(project)).toBe('');
  await runSpoken('.');
  expect(asked.length).toBe(2);
  expect(stages).toEqual(['Writing the spoken story', 'Writing it again']);
  expect(asked[1].prompt.startsWith(asked[0].prompt)).toBe(true);
  expect(asked[1].prompt).toContain('The text you wrote before was refused, because a check in code found this: It had a line that looks like a heading or a list: “## Context”. Write it again, keeping to every rule above.');
  expect(row()).toMatchObject({ spoken: GOOD, spoken_status: 'done' });
});

test('the strict number check reads a magnitude and the quantity words, for deriving and for the spoken story alike', () => {
  db.query("UPDATE projects SET result = 'We reached 50k users and saved $2.5M.' WHERE id = ?").run(project);
  const said = saidAbout(project);
  const told = [{ turn: 1, key: 'changed', part: 'result' as const, question: '', followUp: '', text: 'We reached 50k users and saved $2.5M.', at: 1 }];
  const derived = (t: string) => checkDerived({ context: '', action: '', result: t, learning: '', facts: [] }, told).parts.result;
  for (const t of ['We had 50 users.', 'We saved $2.5 a year.', 'We reached 50 thousand users.', 'It was zero.', 'Hundreds of depots.', 'Thousands of users.', 'Millions saved.', 'Billions moved.',
    'Dozens of calls.', 'We halved it.', 'It tripled.', 'It quadrupled.', 'A tenfold rise.', 'A twofold gain.', 'We had to halve it.', 'It went 50m.']) {
    expect([t, derived(t)]).toEqual([t, null]);
    expect([t, checkSpoken(t, said).ok]).toEqual([t, false]);
  }
  for (const t of ['We reached 50k users.', 'We saved $2.5M.', 'It was the first time.', 'The second release went well.']) {
    expect([t, derived(t)]).toEqual([t, t]);
    expect([t, checkSpoken(t, said).ok]).toEqual([t, true]);
  }
});

test('while the story is being written from what was said, the spoken story waits', async () => {
  db.query("UPDATE projects SET derive_status = 'queued' WHERE id = ?").run(project);
  expect(askSpoken(project)).toBe(DERIVING);
  db.query("UPDATE projects SET derive_status = 'running', spoken_status = 'queued' WHERE id = ?").run(project);
  fakeAsk(() => ({ spoken: GOOD }));
  await runSpoken('.');
  expect(row()).toMatchObject({ spoken: '', spoken_status: 'failed', spoken_note: DERIVING });
  db.query("UPDATE projects SET derive_status = 'done' WHERE id = ?").run(project);
  expect(askSpoken(project)).toBe('');
});

test('a number the owner typed into a part by hand is the owner’s own, and passes', async () => {
  db.query("UPDATE projects SET result = 'Planning went from 9 hours to 2.' WHERE id = ?").run(project);
  await write(`${GOOD}\n\nPlanning went from 9 hours to 2.`);
  expect(row().spoken_status).toBe('done');
  expect(row().spoken).toContain('9 hours to 2');
});

test('a text over 520 words, or with a heading, a list, a quote mark, Markdown marks or a label, is refused; honest speech passes', () => {
  const said = saidAbout(project);
  const long = Array.from({ length: 60 }, () => 'I moved the depots over one by one.').join(' ');
  expect(wordCount(long)).toBe(480);
  expect(checkSpoken(long, said).ok).toBe(true);
  const longer = `${long} ${Array.from({ length: 6 }, () => 'I moved the depots over one by one.').join(' ')}`;
  expect(checkSpoken(longer, said)).toEqual({ ok: false, why: 'It was 528 words, over the 520 a spoken story may have.' });
  for (const [text, line] of [['## Context\nI wrote the scheduler myself.', '## Context'], ['Context: the depots planned on paper.', 'Context: the depots planned on paper.'],
    ['- I wrote the scheduler.', '- I wrote the scheduler.'], ['+ I wrote the scheduler.', '+ I wrote the scheduler.'], ['> I wrote the scheduler.', '> I wrote the scheduler.'],
    ['1. I wrote the scheduler.', '1. I wrote the scheduler.'], ['I wrote the **scheduler** myself.', 'I wrote the **scheduler** myself.'], ['I wrote it *myself*.', 'I wrote it *myself*.'],
    ['What I did:\nI wrote the scheduler myself.', 'What I did:'], ['The depots\n\nI wrote the scheduler myself.', 'The depots']]) {
    expect([text, headingLine(text)]).toEqual([text, line]);
    expect(checkSpoken(text, said)).toEqual({ ok: false, why: `It had a line that looks like a heading or a list: “${line}”.` });
  }
  for (const text of ['I wrote it.\n\nThat was it', 'That was it, really.', 'We shipped “the console”.', 'I wrote the scheduler myself.\nThat was it',
    'The schedulers told me:\n“I want the console.”', '— and then I wrote the scheduler myself.', 'A rough year.\nI wrote the scheduler myself.']) {
    expect([text, headingLine(text)]).toEqual([text, undefined]);
  }
  db.query("UPDATE projects SET context = 'It was 2019.' WHERE id = ?").run(project);
  expect(checkSpoken('2019. A rough year.', saidAbout(project))).toEqual({ ok: true, text: '2019. A rough year.' });
  expect(checkSpoken('   ', said)).toEqual({ ok: false, why: 'Nothing was written.' });
});

test('an owner’s edit is kept: writing again is refused until they replace it, and a run that finds it edited keeps it', async () => {
  await write(GOOD);
  expect(saveSpoken(project, '  I wrote the scheduler myself.  ')).toBe('');
  expect(row()).toMatchObject({ spoken: 'I wrote the scheduler myself.', spoken_wrote: GOOD });
  expect(askSpoken(project)).toBe(HELD);
  expect(row().spoken_status).toBe('done');
  // Edited while it was being written: the owner's text stays, and the note says so.
  expect(askSpoken(project, true)).toBe('');
  fakeAsk(() => { saveSpoken(project, 'My own words, again.'); return { spoken: GOOD }; });
  await runSpoken('.');
  expect(row()).toMatchObject({ spoken: 'My own words, again.', spoken_status: 'done', spoken_note: 'Your own text was kept: you changed it while it was being written.' });
});

test('Replace my edit lets it be replaced', async () => {
  await write(GOOD);
  saveSpoken(project, 'I wrote the scheduler myself.');
  await write('I wrote the scheduler myself in TypeScript.', true);
  expect(row()).toMatchObject({ spoken: 'I wrote the scheduler myself in TypeScript.', spoken_wrote: 'I wrote the scheduler myself in TypeScript.', spoken_status: 'done' });
});

test('Replace my edit then a failure, or a refused text, protects the owner’s text again: Try again asks again', async () => {
  await write(GOOD);
  saveSpoken(project, 'My own words.');
  expect(askSpoken(project, true)).toBe('');
  fakeAsk(() => { throw new Error('The model did not answer in time.'); });
  await runSpoken('.');
  expect(row()).toMatchObject({ spoken: 'My own words.', spoken_status: 'failed' });
  expect(askSpoken(project)).toBe(HELD);
  expect(askSpoken(project, true)).toBe('');
  fakeAsk(() => ({ spoken: 'It saved 80% of the time.' }));
  await runSpoken('.');
  expect(row()).toMatchObject({ spoken: 'My own words.', spoken_status: 'failed' });
  expect(askSpoken(project)).toBe(HELD);
  // The protection holds when the next run finds nothing to ask: a writer's text is not written over the owner's.
  db.run(`UPDATE projects SET spoken_status = 'queued' WHERE id = ${project}`);
  fakeAsk(() => ({ spoken: GOOD }));
  await runSpoken('.');
  expect(row()).toMatchObject({ spoken: 'My own words.', spoken_note: 'Your own text was kept: you changed it while it was being written.' });
});

test('a text the owner cleared is not written again, unless they replace it', async () => {
  await write(GOOD);
  expect(saveSpoken(project, '')).toBe('');
  expect(row()).toMatchObject({ spoken: '', spoken_wrote: GOOD });
  expect(askSpoken(project)).toBe(HELD);
  await write(GOOD, true);
  expect(row().spoken).toBe(GOOD);
});

test('a model failure changes nothing, shows in Activity, and is tried again by the same path', async () => {
  await write(GOOD);
  expect(askSpoken(project)).toBe('');
  fakeAsk(() => { throw new Error('The model did not answer in time.'); });
  expect(await runSpoken('.')).toBe(true);
  expect(row()).toEqual({ spoken: GOOD, spoken_wrote: GOOD, spoken_status: 'failed', spoken_note: 'The model did not answer in time.' });
  expect(activity(Date.now()).items.find((i) => i.kind === 'write-spoken')).toMatchObject({ status: 'failed', reason: 'The model did not answer in time.' });
  await write('I wrote the scheduler myself.');
  expect(row()).toMatchObject({ spoken: 'I wrote the scheduler myself.', spoken_status: 'done' });
  expect(activity(Date.now()).items.some((i) => i.kind === 'write-spoken')).toBe(false);
  expect(await runSpoken('.')).toBe(false);
});

test('the time a text takes to say: its words at 140 a minute, rounded to 10 seconds, and the 3 min 30 s line', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  expect(wordCount("I don't know — it's 35 depots.")).toBe(6);
  expect([spokenSeconds(''), spokenSeconds('Yes.'), spokenSeconds(words(140)), spokenSeconds(words(373)), spokenSeconds(words(490))]).toEqual([0, 10, 60, 160, 210]);
  // 491 words is 210.4 seconds, rounded to 210: still on the aim. 502 is 215.1, rounded to 220: over it.
  expect(spokenSeconds(words(491))).toBe(AIM_SECONDS);
  expect([timeWords(160), timeWords(185), timeWords(50), timeWords(250)]).toEqual(['2 min 40 s', '3 min 05 s', '50 s', '4 min 10 s']);
  expect(timeLine(words(373), null)).toEqual({ line: 'About 2 min 40 s when spoken.', over: false });
  expect(timeLine(words(491), null)).toEqual({ line: 'About 3 min 30 s when spoken.', over: false });
  expect(timeLine(words(502), null)).toEqual({ line: 'About 3 min 40 s when spoken. Aim for 3 min 30 s or less.', over: true });
  expect(timeLine(words(583), 185)).toEqual({ line: 'About 4 min 10 s when spoken. Aim for 3 min 30 s or less. Last timed at 3 min 05 s.', over: true });
});
