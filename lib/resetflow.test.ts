// `bun test lib`: the screen's steps for starting a new record (lib/resetflow.ts), with every answer the network can
// give, and no network. Each fake records which requests were made, in order.
import { expect, test } from 'bun:test';
import { placeOf, startNewRecord, type Answer } from './resetflow.ts';

const RESET = { status: 200, body: { ok: true, deleted: { roles: 2, projects: 1, facts: 9, sources: 3, answers: 4, unsentResumes: 1 }, kept: { jobs: 3, sentResumes: 1 }, notDeleted: [] } };
const SAID = 'A new record is started. Deleted 2 roles, 1 project, 9 facts, 3 sources, 4 answers and 1 unsent resume. Kept 3 jobs, 1 of them sent with its resume.';
const NONE: Answer = { status: 0, body: {} };

function fake(status: Answer, backups: Answer[], reset: Answer = RESET) {
  const asked: string[] = [];
  const deps = {
    status: async () => { asked.push('status'); return status; },
    backup: async () => { asked.push('backup'); return backups.shift() ?? NONE; },
    reset: async () => { asked.push('reset'); return reset; },
  };
  return { asked, deps };
}

test('where it runs: an answer is the studio, a 404 a development machine, anything else stops', () => {
  expect(placeOf({ status: 200, body: {} })).toEqual({ where: 'studio' });
  expect(placeOf({ status: 404, body: { error: 'There is no studio here.' } })).toEqual({ where: 'here' });
  expect(placeOf({ status: 503, body: {} })).toEqual({ where: 'unknown', error: 'The machine is starting. Try again in a moment. Nothing was deleted.' });
  expect(placeOf(NONE)).toEqual({ where: 'unknown', error: 'It couldn’t be told whether the studio’s machine is there. The studio can’t be reached right now. Nothing was deleted.' });
  expect(placeOf({ status: 500, body: {} })).toEqual({ where: 'unknown', error: 'It couldn’t be told whether the studio’s machine is there. The machine answered 500. Nothing was deleted.' });
});

test('on a development machine the reset goes on with no backup', async () => {
  const f = fake({ status: 404, body: {} }, []);
  expect(await startNewRecord(f.deps)).toEqual({ ok: true, error: '', note: SAID });
  expect(f.asked).toEqual(['status', 'reset']);
});

test('when where it runs cannot be told, nothing is asked for after', async () => {
  for (const status of [NONE, { status: 503, body: {} }, { status: 502, body: { error: 'The container did not answer.' } }]) {
    const f = fake(status, []);
    const r = await startNewRecord(f.deps);
    expect(r.ok).toBe(false);
    expect(r.error.endsWith('Nothing was deleted.')).toBe(true);
    expect(f.asked).toEqual(['status']);
  }
});

test('in the studio, a backup that is refused, fails or gets no answer stops it with nothing deleted', async () => {
  for (const backup of [NONE, { status: 409, body: { ok: false, reason: 'the new backup looks much smaller than the last one' } }, { status: 200, body: { ok: false, reason: 'refused' } }, { status: 404, body: {} }]) {
    const f = fake({ status: 200, body: {} }, [backup]);
    const r = await startNewRecord(f.deps);
    expect(r.ok).toBe(false);
    expect(r.error.startsWith('Your record couldn’t be backed up first, so nothing was deleted.')).toBe(true);
    expect(f.asked).toEqual(['status', 'backup']);
  }
});

test('in the studio, the new record is backed up after, and a second backup that fails is said with what to do', async () => {
  const good = fake({ status: 200, body: {} }, [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true, key: 'backups/x' } }]);
  expect(await startNewRecord(good.deps)).toEqual({ ok: true, error: '', note: `${SAID} The new record is backed up.` });
  expect(good.asked).toEqual(['status', 'backup', 'reset', 'backup']);
  const late = fake({ status: 200, body: {} }, [{ status: 200, body: { ok: true } }, NONE]);
  expect((await startNewRecord(late.deps)).note).toBe(`${SAID} The new record isn’t backed up yet. The machine didn’t answer in time. Press Back up now. Until a backup is taken, a restart of the machine brings your old record back.`);
});

test('a refused reset is said in its own words; one with no answer says it is not known', async () => {
  const refused = fake({ status: 404, body: {} }, [], { status: 409, body: { error: 'Work is still waiting or running: a reply in Talk. Wait for it to finish, then try again. Nothing was deleted.' } });
  expect(await startNewRecord(refused.deps)).toEqual({ ok: false, note: '', error: 'Work is still waiting or running: a reply in Talk. Wait for it to finish, then try again. Nothing was deleted.' });
  const lost = fake({ status: 200, body: {} }, [{ status: 200, body: { ok: true } }], NONE);
  expect((await startNewRecord(lost.deps)).error).toBe('No answer came, so it isn’t known whether your record was deleted. Open Experience to see.');
  expect(lost.asked).toEqual(['status', 'backup', 'reset']);
});
