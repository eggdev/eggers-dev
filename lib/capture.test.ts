// `bun test lib`: Capture, the one-question-at-a-time interview about one story (lib/capture.ts), and its stored
// sittings (lib/sittings.ts), on a scratch database with an invented person (lib/scratch.ts).
import { beforeEach, describe, expect, test } from 'bun:test';
import { db, reset, role } from './scratch.ts';
import { syncProjects } from './projects.ts';
import { deleteProject, deleteRole } from './record.ts';
import {
  CLOSING_DONE, CLOSING_PAUSED, checkTurn, FOLLOW_UP_KINDS, FOLLOW_UPS, followUpFor, isBareNo, isDontKnow, nextTurn, OPENING, PARTS, planStep, QUESTIONS,
  answerTo, reminderText, REMINDER_QUOTE_CHARS, type BreakKind, type InterviewerTurn, type Limits, type QuestionKey, type SittingState, type Turn, type TurnStep,
} from './capture.ts';
import * as sittings from './sittings.ts';
import {
  advance, answerTurn, deleteOwnerTurn, deleteSitting, STALE, endSitting, questionStatus, recordAnswer, sitting, sittingsOf, startSitting, toldAbout, turnsOf, type StoredTurn,
} from './sittings.ts';

const ok = <T extends { ok: boolean }>(d: T) => { if (!d.ok) throw new Error(JSON.stringify(d)); return d as Extract<T, { ok: true }>; };
const kinds = (text: string, step: TurnStep = 'question'): BreakKind[] => { const c = checkTurn(text, step); return c.ok ? [] : c.breaks.map((b) => b.kind); };

// An answer with no gap in it: the owner's own part, no habit, and a change with a number.
const PLAIN = 'I rebuilt the rota tool myself, and it cut the wait from 3 days to 1.';
let project = 0, second = 0;

beforeEach(() => {
  reset();
  db.run('DELETE FROM capture_turns');
  db.run('DELETE FROM capture_sittings');
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  project = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Depot rota console', 1) RETURNING id").get() as { id: number }).id;
  second = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (2, 'Quoting API', 1) RETURNING id").get() as { id: number }).id;
});
// The owner's words of an answer, as deriving reads them; null when it is gone or was "I don't know".
const told = (turn: number) => toldAbout(project).find((t) => t.turn === turn)?.text ?? null;

describe('the fixed words', () => {
  test('every fixed question, every fixed follow-up and every fixed line pass checkTurn, with no exception', () => {
    for (const q of QUESTIONS) expect([q.key, checkTurn(q.text, 'question')]).toEqual([q.key, { ok: true }]);
    for (const k of FOLLOW_UP_KINDS) expect([k, checkTurn(FOLLOW_UPS[k].text, 'follow-up')]).toEqual([k, { ok: true }]);
    expect(checkTurn(OPENING, 'opening')).toEqual({ ok: true });
    expect(checkTurn(CLOSING_DONE, 'closing')).toEqual({ ok: true });
    expect(checkTurn(CLOSING_PAUSED, 'closing')).toEqual({ ok: true });
    expect(checkTurn(reminderText('The depot rota console'), 'reminder')).toEqual({ ok: true });
  });

  test('the earlier two-part wordings are refused like any other turn', () => {
    for (const t of ['Tell me about this job. What did the company do, and what was your role?', 'Where did you have to choose between options? What were the options?',
      'What changed because of this work? How do you know?', 'Who else was involved? What did each person do, and what did you do with them?']) expect([t, kinds(t)]).toEqual([t, ['several questions']]);
  });

  test('the questions are about one named piece of work, in CARL order, and none speaks of the job', () => {
    expect(QUESTIONS.map((q) => q.key)).toEqual(['setting', 'before', 'own-part', 'normal-week', 'choice', 'hardest', 'people', 'changed', 'evidence', 'said', 'other-view', 'went-wrong', 'learned', 'missed']);
    expect(QUESTIONS.map((q) => q.part)).toEqual(['context', 'context', 'action', 'action', 'action', 'action', 'action', 'result', 'result', 'result', 'result', 'learning', 'learning', 'close']);
    expect([...new Set(QUESTIONS.map((q) => q.part))]).toEqual([...PARTS]);
    for (const q of QUESTIONS) expect([q.key, /\bjob\b|\bhere\b|\bpick\b/i.test(q.text)]).toEqual([q.key, false]);
  });

  test('the opening says the questions are a fixed list, that the words are kept as given, and what is written from them', () => {
    expect(OPENING).toContain('fixed list');
    expect(OPENING).not.toMatch(/\bAI\b|\bmodel\b/);
    expect(OPENING).toContain('kept word for word');
    expect(OPENING).toContain('four parts and its facts');
    expect(OPENING).toContain('you can change what it writes');
  });

  test('the reminder quotes the project’s name, cut at a word boundary', () => {
    expect(reminderText('  The depot\n rota console  ')).toBe('We carry on with the piece of work you named: “The depot rota console”');
    const text = reminderText(`${'word '.repeat(40)}end`);
    const quote = text.slice(text.indexOf('“') + 1, text.lastIndexOf('”'));
    expect(quote.endsWith('word…')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(REMINDER_QUOTE_CHARS + 1);
  });

  test('the reminder never cuts inside an emoji or a letter with its accent, with or without a space to cut at', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const quoteOf = (t: string) => t.slice(t.indexOf('“') + 1, t.lastIndexOf('”'));
    // No space in the first 121 characters, and an emoji across the 120th.
    const emoji = quoteOf(reminderText(`${'a'.repeat(119)}😀bbbb`));
    expect(lone.test(emoji)).toBe(false);
    expect(emoji).toBe(`${'a'.repeat(119)}…`);
    // No space at all: cut at the limit, between whole characters.
    expect(quoteOf(reminderText('x'.repeat(200)))).toBe(`${'x'.repeat(120)}…`);
    // A family emoji is one character to a reader, made of several code points: it is left out whole.
    expect(quoteOf(reminderText(`${'a'.repeat(115)}👩‍👩‍👧${'b'.repeat(20)}`))).toBe(`${'a'.repeat(115)}…`);
    // A letter and its combining accent stay together.
    expect(quoteOf(reminderText('e\u0301'.repeat(70)))).toBe(`${'e\u0301'.repeat(60)}…`);
    for (const t of [`${'a'.repeat(119)}😀`, `${'a'.repeat(119)}😀 tail`, '我'.repeat(130)]) expect(lone.test(reminderText(t))).toBe(false);
  });

});

// checkTurn is a test of the fixed words only; these show what each kind of break catches.
describe('checkTurn', () => {
  const cases: [BreakKind, string][] = [
    ['several questions', 'What did you build? Who used it every single day?'],
    ['several questions', 'What did you build, and also who used it?'],
    ['several questions', 'What did you build and who used it?'],
    ['several questions', 'Tell me what you built. Describe who used it.'],
    ['no question', 'The console ran every night.'],
    ['praise', 'That is wonderful. What happened next?'],
    ['why', 'Why did you pick Go for the billing run?'],
    ['leading', "Don't you think the rewrite was the turning point?"],
    ['leading', 'Was it the database or the network?'],
    ['hypothetical', 'What would you do differently now?'],
    ['doubt', 'Are you sure it reached 640 users?'],
    ['dates', 'When did you start at Harborlight Systems?'],
    ['dates', 'Did the two jobs overlap?'],
    ['too long', `What happened ${'next and then '.repeat(20)}after that?`],
  ];
  for (const [kind, text] of cases) test(`${kind}: ${text.slice(0, 50)}`, () => expect(kinds(text)).toContain(kind));

  test('a turn that asks without a question mark is a question, and a statement is a break except to open, remind or close', () => {
    expect(kinds('Tell me about a time something at this job went wrong.')).toEqual([]);
    for (const step of ['opening', 'reminder', 'closing'] as const) expect(kinds('The console ran every night.', step)).toEqual([]);
  });
});

describe('follow-ups', () => {
  test('each kind of gap gets its follow-up', () => {
    expect(followUpFor('hardest', 'I would usually restart the queue workers by hand.')).toBe('last-time');
    expect(followUpFor('own-part', 'We rebuilt the quoting service over the summer.')).toBe('own-part');
    expect(followUpFor('changed', 'The team shipped the console to the depots.')).toBe('what-changed');
    expect(followUpFor('before', "I can't remember what was going on then.")).toBe('anchor');
    expect(followUpFor('people', 'We worked with the depot leads and the ops team.')).toBe('own-part');
    expect(followUpFor('people', 'I worked with the depot leads.')).toBeNull();
    expect(followUpFor('hardest', PLAIN)).toBeNull();
    expect(followUpFor('changed', 'Billing went from 6 hours to 40 minutes.')).toBeNull();
  });

  test('a gap is only asked where it fits', () => {
    expect(followUpFor('normal-week', 'I usually spent mornings on code review.')).toBeNull();
    expect(followUpFor('evidence', 'The depot leads used it.')).toBeNull();
    expect(followUpFor('other-view', 'They saw that we were short of people.')).toBeNull();
    // What a company does is a habit by design; "we" there still asks for the owner's part.
    expect(followUpFor('setting', 'We usually sold freight software to depots.')).toBe('own-part');
  });

  test('at most two follow-ups on one question, never the same kind twice, and the cap is a parameter', () => {
    const habitWe = 'We would usually restart the queue workers by hand.';
    expect(followUpFor('hardest', habitWe, [])).toBe('last-time');
    expect(followUpFor('hardest', habitWe, ['last-time'])).toBe('own-part');
    expect(followUpFor('hardest', habitWe, ['last-time', 'own-part'])).toBeNull();
    expect(followUpFor('hardest', habitWe, ['last-time'], 1)).toBeNull();
    expect(followUpFor('hardest', habitWe, ['last-time', 'own-part'], 3)).toBeNull();
  });

  test('"I don\'t know" in its short forms closes the question with no follow-up', () => {
    for (const a of ["I don't know.", "Don't know.", 'Not sure.', "I'm not sure.", 'No idea.', 'I do not know', 'No idea, sorry.', 'Honestly? I really don’t know.', 'dunno', 'Nothing comes to mind.']) {
      expect([a, isDontKnow(a), followUpFor('changed', a)]).toEqual([a, true, null]);
    }
  });

  test('the common longer ways to say it close it too', () => {
    for (const a of ["I don't know one.", "No, I don't know.", 'Nope, no idea.', "I'm afraid I don't know.", "I don't know that one.", 'No idea at all.', 'Not sure tbh.',
      'idk lol', 'N/A', 'n/a', "Haven't a clue.", "I really can't say.", 'I honestly have no idea.', "Don't know, sorry.", 'Unknown.']) {
      expect([a, isDontKnow(a), followUpFor('changed', a)]).toEqual([a, true, null]);
    }
  });

  test('an answer with no letter or digit gets no follow-up and closes nothing', () => {
    for (const a of ['?', '🤷', '...']) expect([a, isDontKnow(a), followUpFor('changed', a)]).toEqual([a, false, null]);
  });

  test('the same words inside an answer do not close it', () => {
    for (const a of ["I couldn't say no to the client.", 'We had no idea it would work.', "I don't know why, but users loved it.", "I can't say enough about the team.",
      'I had no clue it would grow.', "I don't know anyone who complained.", "I don't know, Sarah led it.", "I don't know the exact figure, but it roughly halved the wait.", "I can't remember.",
      "I don't know - Sarah would.", 'Not sure, Sarah led it.', 'No one knew how long it would take.']) {
      expect([a, isDontKnow(a)]).toEqual([a, false]);
    }
  });

  test('a bare "No" is an answer: not "I don\'t know", and no follow-up', () => {
    for (const a of ['No.', 'Nope', 'None.', 'Not really.', 'No, not really.', 'Not that I know of.']) expect([a, isBareNo(a), isDontKnow(a), followUpFor('changed', a)]).toEqual([a, true, false, null]);
  });
});

// Drives a sitting held in memory with the fixed words. answer gives the owner's words for each question.
function runPure(answer: (t: InterviewerTurn) => string, limits?: Partial<Limits>, extra: Partial<SittingState> = {}): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < 200; i++) {
    const n = nextTurn({ turns, limits, ...extra });
    if (n.do === 'ended') return turns;
    if (n.do === 'say') turns.push(n.turn);
    else turns.push(answerTo(turns.at(-1), answer(turns.at(-1) as InterviewerTurn))!);
  }
  throw new Error('The sitting did not end.');
}
const asked = (turns: readonly Turn[]) => turns.flatMap((t) => (t.who === 'interviewer' && t.step === 'question' ? [t.key] : []));

describe('nextTurn', () => {
  test('the fixed list alone drives a whole sitting, in order, from the opening to the closing', () => {
    const turns = runPure(() => PLAIN);
    expect(turns[0]).toEqual({ who: 'interviewer', step: 'opening', text: OPENING });
    expect(asked(turns)).toEqual(QUESTIONS.map((q) => q.key));
    expect(turns.at(-1)).toEqual({ who: 'interviewer', step: 'closing', reason: 'done', text: CLOSING_DONE });
    expect(turns.length).toBe(1 + 2 * QUESTIONS.length + 1);
    for (const t of turns) if (t.who === 'interviewer' && t.step === 'question') expect(t.text).toBe(QUESTIONS.find((q) => q.key === t.key)!.text);
  });

  test('a gap gets its fixed follow-up, at most two on one question, then the next question', () => {
    const turns = runPure((t) => (t.step === 'question' && t.key === 'hardest' ? 'We would usually restart the queue workers by hand.' : t.step === 'follow-up' ? 'We usually did.' : PLAIN));
    const i = turns.findIndex((t) => t.who === 'interviewer' && t.step === 'question' && t.key === 'hardest');
    expect(turns.slice(i + 2, i + 7).map((t) => (t.who === 'interviewer' ? `${t.step}:${t.step === 'follow-up' ? t.kind : t.step === 'question' ? t.key : ''}` : 'owner'))).toEqual(['follow-up:last-time', 'owner', 'follow-up:own-part', 'owner', 'question:people']);
    expect(turns[i + 2]!.text).toBe(FOLLOW_UPS['last-time'].text);
  });

  test('"Not sure." closes the question at once: no follow-up, the next question comes', () => {
    const turns = runPure((t) => (t.step === 'question' && t.key === 'changed' ? 'Not sure.' : PLAIN));
    const i = turns.findIndex((t) => t.who === 'owner' && t.key === 'changed');
    expect(turns[i]).toMatchObject({ closes: true });
    expect(turns[i + 1]).toMatchObject({ step: 'question', key: 'evidence' });
  });

  test('the turn limit closes the sitting, with room for the last answer and the closing line', () => {
    const turns = runPure(() => PLAIN, { maxTurns: 10 });
    expect(turns.length).toBeLessThanOrEqual(10);
    expect(turns.at(-1)).toMatchObject({ step: 'closing', reason: 'limit', text: CLOSING_PAUSED });
    expect(turns.at(-2)!.who).toBe('owner');
    const exact = 1 + 2 * QUESTIONS.length + 1;
    expect(runPure(() => PLAIN, { maxTurns: exact }).at(-1)).toMatchObject({ step: 'closing', reason: 'done' });
    expect(runPure(() => PLAIN, { maxTurns: exact - 1 }).at(-1)).toMatchObject({ step: 'closing', reason: 'limit' });
  });

  test('the owner stopping closes the sitting, even with a question waiting', () => {
    const turns: Turn[] = [{ who: 'interviewer', step: 'opening', text: OPENING }, { who: 'interviewer', step: 'question', key: 'setting', text: QUESTIONS[0].text }];
    expect(nextTurn({ turns })).toEqual({ do: 'wait' });
    expect(nextTurn({ turns, stop: true })).toEqual({ do: 'say', turn: { who: 'interviewer', step: 'closing', reason: 'stopped', text: CLOSING_PAUSED } });
  });

  test('with every question settled, the opening is followed by the closing', () => {
    const all = new Set<QuestionKey>(QUESTIONS.map((q) => q.key));
    expect(planStep({ turns: [{ who: 'interviewer', step: 'opening', text: OPENING }], settled: all })).toEqual({ step: 'closing', reason: 'done' });
  });

  test('a later sitting reminds the owner of the piece of work named, right after the opening; a first sitting does not', () => {
    const turns = runPure(() => PLAIN, undefined, { title: 'The depot rota console', settled: new Set<QuestionKey>(['setting']) });
    expect(turns.slice(0, 3).map((t) => (t.who === 'interviewer' ? t.step : 'owner'))).toEqual(['opening', 'reminder', 'question']);
    expect(turns[1]!.text).toBe(reminderText('The depot rota console'));
    expect(turns.filter((t) => t.who === 'interviewer' && t.step === 'reminder').length).toBe(1);
    expect(runPure(() => PLAIN, undefined, { title: 'The depot rota console' }).slice(0, 2).map((t) => (t.who === 'interviewer' ? t.step : 'owner'))).toEqual(['opening', 'question']);
  });

  test('an answer under a question no longer in the list settles nothing and gets no follow-up', () => {
    const turns: Turn[] = [{ who: 'interviewer', step: 'opening', text: OPENING }, { who: 'interviewer', step: 'question', key: null, text: 'An old question.' },
      { who: 'owner', text: 'We usually did it that way.', key: null, followUp: null, closes: false }];
    expect(planStep({ turns })).toEqual({ step: 'question', key: 'setting' });
  });
});

// Drives a stored sitting with advance and recordAnswer, as the worker will. Returns the sitting's turns.
let clock = 1000;
function runStored(id: number, answer: (t: StoredTurn) => string, stopAfter?: QuestionKey): StoredTurn[] {
  for (let i = 0; i < 200; i++) {
    const last = turnsOf(id).at(-1);
    const stop = stopAfter !== undefined && last?.who === 'owner' && last.key === stopAfter;
    const r = ok(advance(id, clock++, { stop }));
    if (r.now === 'ended') return turnsOf(id);
    ok(recordAnswer(id, answer(turnsOf(id).at(-1)!), clock++));
  }
  throw new Error('The sitting did not end.');
}
const keyOf = (t: StoredTurn) => (t.who === 'owner' || t.step === 'question' || t.step === 'follow-up' ? t.key : null);

describe('sittings', () => {
  test("no exported function takes interviewer words: only the owner's answer is free text", () => {
    // Every function the module exports, with its parameters. Only recordAnswer and answerTurn take text, and they store
    // it as the owner's. advance takes a sitting, a time and options (stop, limits); its words come from lib/capture.ts.
    const heads = Object.entries(sittings).filter(([, v]) => typeof v === 'function').map(([k, v]) => {
      const src = String(v);
      return [k, src.slice(src.indexOf('(') + 1, src.indexOf(')')).replace(/\s+/g, ' ')];
    }).sort();
    expect(heads).toEqual([
      ['advance', 'sittingId, now, opts = {}'], ['answerTurn', 'sittingId, turnId, text, now, opts = {}'], ['deleteOwnerTurn', 'turnId'], ['deleteSitting', 'sittingId'], ['endSitting', 'sittingId, reason, now'],
      ['hasSaid', 'project'], ['projectTitle', 'project'], ['questionStatus', 'project'], ['queueDerive', 'project'], ['recordAnswer', 'sittingId, text, now'], ['sitting', 'id'], ['sittingsOf', 'project'],
      ['startSitting', 'project, now'], ['stateOf', 'sittingId, opts = {}'], ['storyRefused', 'role'], ['toldAbout', 'project'], ['turnsOf', 'sittingId'],
    ]);
    // advance ignores anything else a caller puts in its options.
    const { id: other } = ok(startSitting(second, 90));
    ok(advance(other, 91, { text: 'Great answer! Why did you leave?', key: 'missed' } as unknown as { stop?: boolean }));
    expect(turnsOf(other).map((t) => t.text)).toEqual([OPENING, QUESTIONS[0].text]);
  });

  test('only advance writes an interviewer turn, and it says nothing more while an answer is due', () => {
    const { id } = ok(startSitting(project, 100));
    const first = ok(advance(id, 101));
    expect(first.said.map((t) => [t.step, t.text])).toEqual([['opening', OPENING], ['question', QUESTIONS[0].text]]);
    expect(first.now).toBe('waiting');
    // While an answer is due, advance says nothing more.
    expect(ok(advance(id, 102)).said).toEqual([]);
    expect(turnsOf(id).length).toBe(2);
  });

  test('a whole stored sitting asks each question once, in order, in its fixed words, and ends itself', () => {
    const { id, resumed } = ok(startSitting(project, 100));
    expect(resumed).toBe(false);
    const turns = runStored(id, () => PLAIN);
    expect(asked(turns)).toEqual(QUESTIONS.map((q) => q.key));
    for (const t of turns) if (t.who === 'interviewer' && t.step === 'question') expect([t.question, t.text]).toEqual([t.key!, QUESTIONS.find((q) => q.key === t.key)!.text]);
    expect(sitting(id)).toMatchObject({ state: 'ended', endedBy: 'done', project });
    expect(questionStatus(project).every((q) => q.state === 'answered')).toBe(true);
    expect(startSitting(project, 200)).toEqual({ ok: false, error: 'Every question about this is already answered.' });
    expect(advance(id, 300)).toEqual({ ok: true, said: [], now: 'ended' });
  });

  test("the owner's words are stored exactly as given", () => {
    const awkward = [
      '   leading spaces, and trailing ones   ',
      'Line one\n\n  line two after a blank line\r\nand a Windows line end\t(with a tab)',
      'Emoji 🚚📦👩🏽‍💻 and “curly quotes”, ‘single’ ones, "straight" ones and it\'s',
      'MiXeD CaSe, teh speling misteaks, and   three   spaces',
    ];
    const { id } = ok(startSitting(project, 100));
    let i = 0;
    const turns = runStored(id, () => awkward[i++ % awkward.length]!, 'normal-week');
    const owner = turns.filter((t) => t.who === 'owner');
    expect(owner.map((t) => t.text)).toEqual(awkward);
    expect(owner.map((t) => told(t.id))).toEqual(awkward);
    expect(told(turns[0]!.id)).toBeNull();
  });

  test('an answer that would not read back the same is refused, and nothing is stored', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const before = turnsOf(id).length;
    // A leading byte-order mark and a broken half of a pair do not read back the same: refused, nothing stored.
    for (const odd of ['\uFEFFbom first', 'lone high:\uD83D end', 'lone low:\uDE00 end']) {
      const r = recordAnswer(id, odd, 102);
      expect([JSON.stringify(odd), r.ok]).toEqual([JSON.stringify(odd), false]);
      if (!r.ok) expect(r.error).toContain('could not be stored exactly as you gave it');
    }
    expect(turnsOf(id).length).toBe(before);
    // A NUL character does read back the same, so it is stored as given.
    const nul = ok(recordAnswer(id, 'nul:\u0000:after', 103));
    expect(turnsOf(id).find((t) => t.id === nul.id)!.text).toBe('nul:\u0000:after');
  });

  test('an empty answer, an answer with nothing waiting and an answer in an ended sitting are refused', () => {
    const { id } = ok(startSitting(project, 100));
    expect(recordAnswer(id, 'Too early.', 101)).toEqual({ ok: false, error: 'No question is waiting for an answer.' });
    ok(advance(id, 102));
    expect(recordAnswer(id, ' \n\t ', 103)).toEqual({ ok: false, error: 'The answer is empty.' });
    for (const a of ['?', '🤷', '...']) expect(recordAnswer(id, a, 103)).toEqual({ ok: false, error: 'The answer has no words in it. If you do not know, say "I don\'t know".' });
    expect(ok(advance(id, 104, { stop: true })).said.map((t) => t.step)).toEqual(['closing']);
    expect(sitting(id)).toMatchObject({ state: 'ended', endedBy: 'stopped' });
    expect(recordAnswer(id, PLAIN, 105)).toEqual({ ok: false, error: 'That sitting has ended.' });
    expect(startSitting(99, 106)).toEqual({ ok: false, error: 'That project is not in the record.' });
    expect(advance(99999, 107)).toEqual({ ok: false, error: 'That sitting is not in the record.' });
  });

  test('a sitting ended without a closing line is ended for advance too', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    expect(endSitting(id, 'stopped', 102)).toBe(true);
    expect(endSitting(id, 'stopped', 103)).toBe(false);
    expect(advance(id, 104)).toEqual({ ok: true, said: [], now: 'ended' });
    expect(sitting(id)).toMatchObject({ state: 'ended', endedBy: 'stopped', endedAt: 102 });
  });

  test('a second sitting resumes with the questions not yet answered, after a reminder of the piece of work named', () => {
    const first = ok(startSitting(project, 100)).id;
    expect(startSitting(project, 101)).toEqual({ ok: true, id: first, resumed: true });
    const one = runStored(first, () => PLAIN, 'before');
    expect(asked(one)).toEqual(['setting', 'before']);
    expect(one.some((t) => t.who === 'interviewer' && t.step === 'reminder')).toBe(false);
    expect(one.at(-1)).toMatchObject({ step: 'closing', reason: 'stopped', text: CLOSING_PAUSED });
    expect(questionStatus(project).slice(0, 3).map((q) => q.state)).toEqual(['answered', 'answered', 'open']);
    const next = ok(startSitting(project, 500));
    expect(next.resumed).toBe(false);
    const two = runStored(next.id, () => PLAIN);
    expect(two.slice(0, 3).map((t) => (t.who === 'interviewer' ? t.step : 'owner'))).toEqual(['opening', 'reminder', 'question']);
    expect(two[1]!.text).toBe('We carry on with the piece of work you named: “Depot rota console”');
    expect(asked(two)).toEqual(QUESTIONS.map((q) => q.key).slice(2));
    expect(sittingsOf(project).map((s) => s.endedBy)).toEqual(['stopped', 'done']);
  });

  test('the reminder quotes the project’s name as it stands, and the name of the row that carries a side project', () => {
    runStored(ok(startSitting(project, 100)).id, () => PLAIN, 'setting');
    db.query("UPDATE projects SET title = 'The depot rota console' WHERE id = ?").run(project);
    expect(ok(advance(ok(startSitting(project, 200)).id, 201)).said[1]!.text).toBe('We carry on with the piece of work you named: “The depot rota console”');
    role({ id: 10, company: 'Tidepool', title: '', standing: 'personal' });
    syncProjects(1);
    const side = (db.query('SELECT id FROM projects WHERE via_role = 10').get() as { id: number }).id;
    runStored(ok(startSitting(side, 300)).id, () => PLAIN, 'setting');
    expect(ok(advance(ok(startSitting(side, 400)).id, 401)).said[1]!.text).toBe('We carry on with the piece of work you named: “Tidepool”');
  });

  test('no reminder when an earlier sitting settled nothing', () => {
    const one = ok(startSitting(project, 100)).id;
    ok(advance(one, 101));
    ok(advance(one, 102, { stop: true }));
    const two = runStored(ok(startSitting(project, 200)).id, () => PLAIN);
    expect(two.slice(0, 2).map((t) => (t.who === 'interviewer' ? t.step : 'owner'))).toEqual(['opening', 'question']);
  });

  test('"I don\'t know" closes a question for good, in every later sitting of the same project', () => {
    const first = ok(startSitting(project, 100)).id;
    const one = runStored(first, (t) => (t.who === 'interviewer' && t.step === 'question' && t.key === 'changed' ? "I'm not sure." : PLAIN), 'evidence');
    expect(one.find((t) => t.who === 'owner' && t.key === 'changed')).toMatchObject({ closes: true, text: "I'm not sure." });
    expect(questionStatus(project).find((q) => q.key === 'changed')!.state).toBe('closed');
    const two = runStored(ok(startSitting(project, 500)).id, () => PLAIN);
    expect(asked(two)).toEqual(['said', 'other-view', 'went-wrong', 'learned', 'missed']);
    expect(asked(runStored(ok(startSitting(second, 900)).id, () => PLAIN))).toEqual(QUESTIONS.map((q) => q.key));
  });

  test('a bare "No" settles a question without closing it, and gets no follow-up', () => {
    const { id } = ok(startSitting(project, 100));
    const turns = runStored(id, (t) => (keyOf(t) === 'said' ? 'No.' : PLAIN), 'other-view');
    const i = turns.findIndex((t) => t.who === 'owner' && t.key === 'said');
    expect(turns[i]).toMatchObject({ closes: false });
    expect(turns[i + 1]).toMatchObject({ step: 'question', key: 'other-view' });
    expect(questionStatus(project).find((q) => q.key === 'said')!.state).toBe('answered');
  });

  test('a stored turn under a question key that has left the list settles nothing, and nothing throws', () => {
    runStored(ok(startSitting(project, 100)).id, () => PLAIN, 'before');
    const again = ok(startSitting(project, 200)).id;
    ok(advance(again, 201));
    // The setting answer of the first sitting, and the question now waiting, are filed under retired keys.
    db.run("UPDATE capture_turns SET question = 'old-key' WHERE question = 'setting'");
    db.run(`UPDATE capture_turns SET question = 'old-waiting' WHERE id = ${turnsOf(again).at(-1)!.id}`);
    expect(turnsOf(again).at(-1)).toMatchObject({ step: 'question', key: null, question: 'old-waiting' });
    expect(questionStatus(project).find((q) => q.key === 'setting')!.state).toBe('open');
    expect(ok(advance(again, 202)).said).toEqual([]);
    const a = ok(recordAnswer(again, 'We usually did it that way.', 203));
    expect(turnsOf(again).find((t) => t.id === a.id)).toMatchObject({ key: null, question: 'old-waiting' });
    // No follow-up on it: the next question is the first open one.
    expect(ok(advance(again, 204)).said.map((t) => [t.step, keyOf(t)])).toEqual([['question', 'setting']]);
    expect(ok(advance(again, 205, { stop: true })).now).toBe('ended');
    expect(startSitting(project, 300)).toMatchObject({ ok: true, resumed: false });
  });

  test('a sitting left from when a role could be told is never shown, counted, continued or deleted here', () => {
    const old = (db.query('INSERT INTO capture_sittings (role_id, started_at) VALUES (1, 1) RETURNING id').get() as { id: number }).id;
    const said = (db.query("INSERT INTO capture_turns (sitting_id, who, step, text, question, at) VALUES (?, 'owner', 'answer', 'I ran the platform team.', 'setting', 2) RETURNING id").get(old) as { id: number }).id;
    expect(sitting(old)).toBeNull();
    expect(turnsOf(old)).toEqual([]);
    expect(advance(old, 3)).toEqual({ ok: false, error: 'That sitting is not in the record.' });
    expect(recordAnswer(old, PLAIN, 3)).toEqual({ ok: false, error: 'That sitting is not in the record.' });
    expect(deleteOwnerTurn(said)).toBe(false);
    expect(deleteSitting(old)).toBe(false);
    expect(endSitting(old, 'stopped', 3)).toBe(false);
    expect(questionStatus(project).every((q) => q.state === 'open')).toBe(true);
  });

  test('a sitting ends at 40 turns by default, the closing line included', () => {
    const { id } = ok(startSitting(project, 100));
    const turns = runStored(id, () => 'We would usually just restart the workers.');
    expect(turns.length).toBe(40);
    expect(turns.at(-1)).toMatchObject({ step: 'closing', reason: 'limit' });
    expect(sitting(id)).toMatchObject({ state: 'ended', endedBy: 'limit' });
  });

  test('deleting a sitting takes its turns, and its questions open again', () => {
    const keep = ok(startSitting(second, 50)).id;
    runStored(keep, () => PLAIN, 'setting');
    const { id } = ok(startSitting(project, 100));
    runStored(id, () => PLAIN, 'before');
    expect(deleteSitting(id)).toBe(true);
    expect(sitting(id)).toBeNull();
    expect((db.query('SELECT count(*) AS n FROM capture_turns WHERE sitting_id = ?').get(id) as { n: number }).n).toBe(0);
    expect(questionStatus(project).every((q) => q.state === 'open')).toBe(true);
    expect(turnsOf(keep).length).toBeGreaterThan(0);
    expect(deleteSitting(id)).toBe(false);
  });

  test('deleting one owner turn leaves the question, which then waits for an answer again', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const a = ok(recordAnswer(id, PLAIN, 102));
    const question = turnsOf(id).find((t) => t.who === 'interviewer' && t.step === 'question')!;
    expect(deleteOwnerTurn(question.id)).toBe(false);
    expect(deleteOwnerTurn(a.id)).toBe(true);
    expect(turnsOf(id).some((t) => t.id === a.id)).toBe(false);
    expect(questionStatus(project)[0]!.state).toBe('open');
    expect(ok(advance(id, 103)).now).toBe('waiting');
    ok(recordAnswer(id, 'I ran the platform team myself.', 104));
    expect(questionStatus(project)[0]!.state).toBe('answered');
  });

  test('answerTurn stores the answer to the turn waiting and moves on, once: a second send for the same turn is refused', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const asked = turnsOf(id).at(-1)!;
    const a = ok(answerTurn(id, asked.id, PLAIN, 102));
    expect(a.said.map((t) => [t.step, t.text])).toEqual([['question', QUESTIONS[1].text]]);
    expect(a.now).toBe('waiting');
    expect(answerTurn(id, asked.id, PLAIN, 103)).toEqual({ ok: false, error: STALE, stale: true });
    expect(answerTurn(id, 99999, PLAIN, 103)).toEqual({ ok: false, error: STALE, stale: true });
    expect(turnsOf(id).filter((t) => t.who === 'owner').map((t) => [t.text, t.question])).toEqual([[PLAIN, 'setting']]);
    // recordAnswer's own refusals come through in its words, and store nothing.
    const waiting = turnsOf(id).at(-1)!.id;
    expect(answerTurn(id, waiting, '?', 104)).toEqual({ ok: false, error: 'The answer has no words in it. If you do not know, say "I don\'t know".' });
    ok(advance(id, 105, { stop: true }));
    expect(answerTurn(id, waiting, PLAIN, 106)).toEqual({ ok: false, error: 'That sitting has ended.', stale: true });
    expect(answerTurn(424242, waiting, PLAIN, 106)).toEqual({ ok: false, error: 'That sitting is not in the record.' });
  });

  test('answerTurn is one transaction: when the next turn cannot be stored, the answer is not stored either', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const asked = turnsOf(id).at(-1)!;
    db.run("CREATE TEMP TRIGGER no_interviewer BEFORE INSERT ON capture_turns WHEN NEW.who = 'interviewer' BEGIN SELECT RAISE(ABORT, 'the disk is full'); END");
    try {
      expect(() => answerTurn(id, asked.id, PLAIN, 102)).toThrow();
    } finally { db.run('DROP TRIGGER no_interviewer'); }
    expect(turnsOf(id).map((t) => t.id)).toEqual(turnsOf(id).filter((t) => t.who === 'interviewer').map((t) => t.id));
    expect(turnsOf(id).at(-1)!.id).toBe(asked.id);
    // The question still waits, so the next send is taken.
    expect(ok(answerTurn(id, asked.id, PLAIN, 103)).said.map((t) => t.text)).toEqual([QUESTIONS[1].text]);
  });

  test('deleting an answer takes its follow-up answers in that sitting with it; deleting a follow-up answer takes only that one', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const last = () => turnsOf(id).at(-1)!.id;
    ok(answerTurn(id, last(), PLAIN, 102));
    ok(answerTurn(id, last(), "I don't know", 104));
    // "own-part": "we" and no "I" gets the own-part follow-up.
    const main = ok(answerTurn(id, last(), 'We moved forty services.', 105));
    expect(main.said.map((t) => t.step)).toEqual(['follow-up']);
    const follow = ok(answerTurn(id, last(), 'I wrote the plan for each service.', 106));
    const ownPart = () => questionStatus(project).find((q) => q.key === 'own-part')!.state;
    expect(ownPart()).toBe('answered');
    // A follow-up answer alone: the answer it followed stays, and so does the question's state.
    expect(deleteOwnerTurn(follow.id)).toBe(true);
    expect([told(follow.id), told(main.id), ownPart()]).toEqual([null, 'We moved forty services.', 'answered']);
    // The answer itself: the question opens again, and the next sitting asks it after the opening and the reminder.
    ok(advance(id, 107, { stop: true }));
    expect(deleteOwnerTurn(main.id)).toBe(true);
    expect(ownPart()).toBe('open');
    const two = ok(startSitting(project, 200)).id;
    expect(ok(advance(two, 201)).said.map((t) => (t.step === 'question' ? t.key : t.step))).toEqual(['opening', 'reminder', 'own-part']);
    // In that sitting, an answer with a follow-up answer: deleting the answer takes both.
    const lastIn = () => turnsOf(two).at(-1)!.id;
    const m2 = ok(answerTurn(two, lastIn(), 'We moved the queues.', 202));
    expect(m2.said.map((t) => t.step)).toEqual(['follow-up']);
    const f2 = ok(answerTurn(two, lastIn(), 'I moved the payment queue myself.', 203));
    expect(deleteOwnerTurn(m2.id)).toBe(true);
    expect([told(m2.id), told(f2.id), ownPart()]).toEqual([null, null, 'open']);
    // Answers to other questions in the same sitting stay.
    expect(turnsOf(id).filter((t) => t.who === 'owner').map((t) => t.question)).toEqual(['setting', 'before']);
  });

  test('an answer deleted after later turns is not asked again out of order: it comes first in the next sitting', () => {
    const { id } = ok(startSitting(project, 100));
    ok(advance(id, 101));
    const setting = ok(recordAnswer(id, 'I ran the platform team.', 102));
    ok(advance(id, 103));
    expect(deleteOwnerTurn(setting.id)).toBe(true);
    // The second question is waiting; once answered, the list goes on in order, without setting.
    ok(recordAnswer(id, 'The depots planned on paper.', 104));
    expect(ok(advance(id, 105)).said.map((t) => keyOf(t))).toEqual(['own-part']);
    expect(questionStatus(project)[0]!.state).toBe('open');
    ok(advance(id, 106, { stop: true }));
    const next = ok(advance(ok(startSitting(project, 200)).id, 201)).said;
    expect(next.map((t) => (t.step === 'question' ? t.key : t.step))).toEqual(['opening', 'reminder', 'setting']);
  });

  test('limits are whole numbers that may only lower the defaults, and bad ones throw before anything is stored', () => {
    const { id } = ok(startSitting(project, 100));
    for (const limits of [{ maxTurns: 1 }, { maxTurns: 3 }, { maxTurns: 4.5 }, { maxTurns: 41 }, { maxTurns: Number.NaN }, { maxFollowUps: -1 }, { maxFollowUps: 3 }, { maxFollowUps: 1.5 }]) {
      expect(() => advance(id, 101, { limits })).toThrow();
    }
    expect(turnsOf(id)).toEqual([]);
    // The fewest turns: an opening, one question, one answer and a closing line.
    expect(ok(advance(id, 102, { limits: { maxTurns: 4 } })).now).toBe('waiting');
    ok(recordAnswer(id, PLAIN, 103));
    expect(ok(advance(id, 104, { limits: { maxTurns: 4 } })).said.map((t) => t.step)).toEqual(['closing']);
    expect(turnsOf(id).length).toBe(4);
    expect(sitting(id)).toMatchObject({ endedBy: 'limit' });
  });

  const count = (sql: string) => (db.query(sql).get() as { n: number }).n;
  const allTurns = () => count('SELECT count(*) AS n FROM capture_turns');

  test('deleting a role takes its stories’ sittings and turns, and a plain DELETE of a role takes any sitting left from it', () => {
    const p1 = ok(startSitting(project, 100)).id; runStored(p1, () => PLAIN, 'before');
    const p2 = ok(startSitting(second, 100)).id; runStored(p2, () => PLAIN, 'before');
    const left = turnsOf(p2).length;
    ok(deleteRole(1));
    expect(sitting(p1)).toBeNull();
    expect(count(`SELECT count(*) AS n FROM capture_turns WHERE sitting_id = ${p1}`)).toBe(0);
    expect(allTurns()).toBe(left);
    const old = (db.query('INSERT INTO capture_sittings (role_id, started_at) VALUES (2, 1) RETURNING id').get() as { id: number }).id;
    db.query("INSERT INTO capture_turns (sitting_id, who, step, text, at) VALUES (?, 'owner', 'answer', 'Old words.', 2)").run(old);
    db.run('DELETE FROM roles WHERE id = 2');
    expect(count(`SELECT count(*) AS n FROM capture_sittings WHERE id = ${old}`)).toBe(0);
    expect(allTurns()).toBe(left);
  });

  test('deleting a project takes its sittings and turns, whether by record.ts or by a plain DELETE', () => {
    const p1 = ok(startSitting(project, 100)).id;
    const turns = runStored(p1, () => PLAIN, 'before');
    expect(turns[1]).toMatchObject({ key: 'setting', text: QUESTIONS[0].text });
    const kept = ok(startSitting(second, 100)).id; runStored(kept, () => PLAIN, 'before');
    ok(deleteProject(project));
    expect(sitting(p1)).toBeNull();
    expect(count(`SELECT count(*) AS n FROM capture_turns WHERE sitting_id = ${p1}`)).toBe(0);
    expect(sitting(kept)).not.toBeNull();
    const p2 = kept;
    db.run(`DELETE FROM projects WHERE id = ${second}`);
    expect(sitting(p2)).toBeNull();
    expect(count(`SELECT count(*) AS n FROM capture_turns WHERE sitting_id = ${p2}`)).toBe(0);
  });

  test('a sitting row names exactly one of a role or a project, as it always has', () => {
    expect(() => db.run('INSERT INTO capture_sittings (role_id, project_id, started_at) VALUES (1, 1, 1)')).toThrow();
    expect(() => db.run('INSERT INTO capture_sittings (role_id, project_id, started_at) VALUES (NULL, NULL, 1)')).toThrow();
  });
});
