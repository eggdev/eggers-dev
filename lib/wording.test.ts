// `bun test lib`: rule 7, stage 3b. Two new openings for a bullet of a resume the owner edited, made by code with no
// model: the first word in the tense the job needs, and a duty opener ("Responsible for building") as the owner's own
// verb ("Built"). The rest of the line stays byte for byte. Made, guarded, stored and decided as the suggestions of 3a.
// Everything is invented.
import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, seed } from './scratch.ts';
import { fakeAsk } from './llm.ts';
import { storeLinks, type Links } from './links.ts';
import { syncSkills } from './skills.ts';
import { resumeView } from './resumeview.ts';
import { decide, guard, seeRoles, shownSuggestions, suggestAfterRoles, suggestAfterSave, suggestSkills } from './suggest.ts';
import { dutyOpening, OPENERS, tenseOpening } from './wording.ts';

const ENDED = '### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021 · Duluth, MN', NOW = '### Director of Engineering, Harborlight Systems\nMar 2021 – Present · Remote';
const resumeOf = (bullets: string[], head = ENDED) => `# Avery Lindqvist\nDuluth, MN\n\n## Experience\n${head}\n${bullets.map((b) => `- ${b}`).join('\n')}\n\n## Skills\nGo, Kafka`;
function job(resume: string, o: { edited?: number; links?: Links } = {}): number {
  return (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, links, created_at, edited, outcome) VALUES ('A posting.', 'Staff Engineer', 'Nimbus Yard', 'done', '{}', ?, ?, 1, ?, '') RETURNING id")
    .get(resume, o.links ? storeLinks(o.links) : '', o.edited ?? 1) as { id: number }).id;
}
const row = (id: number) => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as { resume: string; links: string; edited: number };
type Sug = { id: number; where_: string; old: string; new: string; kind: string; why: string; status: string; source: string };
const sugs = (id: number) => db.query('SELECT * FROM resume_suggestions WHERE job_id = ? ORDER BY id').all(id) as Sug[];
// The suggestions the owner's Save makes for one line alone, under a job that ended (or the job held now): [new, why].
function after(line: string, current = false): [string, string][] {
  const id = job(resumeOf([line], current ? NOW : ENDED));
  suggestAfterSave(id, 1);
  return sugs(id).map((s) => [s.new.replace(/^- /, ''), s.why]);
}
// Each new line keeps the old line's words after its opening, byte for byte.
const restKept = (old: string, now: string) => old.endsWith(now.slice(now.search(/\s|$/)));

let asked = 0;
beforeEach(() => {
  seed();
  syncSkills(1);
  asked = 0;
  // No model is asked anywhere here: a call is counted, and fails.
  fakeAsk(() => { asked++; throw new Error('No model is asked for a suggestion.'); });
});

// ---------- 1. The tense ----------
test('the tense: the first word gets the ending the job needs, and nothing else changes', () => {
  expect(after('Lead the weekly incident review.')).toEqual([['Led the weekly incident review.', 'Past tense for a job that has ended.']]);
  expect(after('Builds the billing run.')).toEqual([['Built the billing run.', 'Past tense for a job that has ended.']]);
  expect(after('Manage the billing team of 6.')).toEqual([['Managed the billing team of 6.', 'Past tense for a job that has ended.']]);
  expect(after('Ship the quoting API.')).toEqual([['Shipped the quoting API.', 'Past tense for a job that has ended.']]);
  expect(after('Write the test plan for the billing service.')).toEqual([['Wrote the test plan for the billing service.', 'Past tense for a job that has ended.']]);
  expect(after('Oversee the move of billing to Go.')).toEqual([['Oversaw the move of billing to Go.', 'Past tense for a job that has ended.']]);
  // For the job held now: the present tense.
  expect(after('Built the billing run.', true)).toEqual([['Build the billing run.', 'Present tense for the job you hold now.']]);
  expect(after('Managed the billing team.', true)).toEqual([['Manage the billing team.', 'Present tense for the job you hold now.']]);
  expect(after('Shipped the quoting API.', true)).toEqual([['Ship the quoting API.', 'Present tense for the job you hold now.']]);
  expect(after('Led the incident review, every week.', true)).toEqual([['Lead the incident review, every week.', 'Present tense for the job you hold now.']]);
});

test('the tense: no suggestion when the first word is not surely a verb, or the tense is right', () => {
  // A title, not a verb.
  expect(after('Lead engineer for the billing rewrite.')).toEqual([]);
  expect(after('Lead developer on the quoting API.')).toEqual([]);
  expect(after('Head of platform for two years.')).toEqual([]);
  expect(after('Staff engineer on the billing rewrite.')).toEqual([]);
  expect(after('Principal engineer for billing.')).toEqual([]);
  // A first word the verb table does not know, or no verb at all.
  expect(after('Streamlined the billing run.', true)).toEqual([]);
  expect(after('Fail to ship the new billing service on time.')).toEqual([]);
  expect(after('Billing run rebuilt in Go.')).toEqual([]);
  // The tense is right already, or reads the same in both tenses.
  expect(after('Led the weekly incident review.')).toEqual([]);
  expect(after('Cut the queue from 900 jobs at peak to 210.')).toEqual([]);
  // The transformation alone: the rest of the line byte for byte.
  const o = tenseOpening('Lead the team’s  rebuild — with ﬁnance, 12 a day.', false)!;
  expect([o.from, o.to, o.rest]).toEqual(['Lead', 'Led', ' the team’s  rebuild — with ﬁnance, 12 a day.']);
});

test('a resume a model wrote, and a sent one, get no suggestion', () => {
  const written = job(resumeOf(['Lead the weekly incident review.', 'Responsible for building the billing run.']), { edited: 0 });
  suggestAfterSave(written, 1);
  expect(sugs(written)).toEqual([]);
  const sent = job(resumeOf(['Lead the weekly incident review.']));
  db.run("UPDATE jobs SET outcome = 'applied' WHERE id = ?", [sent]);
  suggestAfterSave(sent, 1);
  expect(sugs(sent)).toEqual([]);
});

// ---------- 2. A duty opener followed by the owner's own -ing verb ----------
test('a duty opener and an -ing verb: the verb, in the tense the job needs; the rest stays', () => {
  const line = 'Responsible for building the rail yard scheduler that runs 300 trains a day.';
  expect(after(line)).toEqual([['Built the rail yard scheduler that runs 300 trains a day.', 'Opens with what you did: “Built”, in place of “Responsible for building”.']]);
  expect(after(line, true)).toEqual([['Build the rail yard scheduler that runs 300 trains a day.', 'Opens with what you do: “Build”, in place of “Responsible for building”.']]);
  // Each opener, in any case.
  expect(OPENERS).toEqual(['was responsible for', 'responsible for', 'tasked with', 'in charge of', 'duties included', 'duties include', 'charged with']);
  for (const opener of ['Was responsible for', 'responsible for', 'Tasked with', 'In charge of', 'Duties included', 'Duties include', 'CHARGED WITH'])
    expect(after(`${opener} running the nightly billing run.`).map(([n]) => n)).toEqual(['Ran the nightly billing run.']);
  expect(after('Tasked with testing the billing run.')).toEqual([['Tested the billing run.', 'Opens with what you did: “Tested”, in place of “Tasked with testing”.']]);
  expect(after('Responsible for managing the billing team.').map(([n]) => n)).toEqual(['Managed the billing team.']);
  expect(after('Responsible for planning the move of billing to Go.').map(([n]) => n)).toEqual(['Planned the move of billing to Go.']);
  // The hedge is the owner's own verb, and it stays.
  expect(after('Responsible for helping the team reduce errors in the billing run.').map(([n]) => n)).toEqual(['Helped the team reduce errors in the billing run.']);
});

test('a duty opener gets no suggestion with a noun after it, any other opener, or an -ing word the table does not know', () => {
  for (const line of ['Responsible for the nightly billing run.', 'Worked on building the billing service.', 'Helped with building the billing service.', 'Assisted in building the billing service.',
    'Involved in building the billing service.', 'Served as lead for building the billing service.', 'Acted as owner of the billing run.', 'Participated in building the billing service.',
    'Responsible for approving invoices built by the vendor.', 'Responsible for pricing strategy.', 'Responsible for onboarding new engineers.'])
    expect([line, after(line)]).toEqual([line, []]);
  expect(dutyOpening('Responsible for building  the billing run.', false)).toMatchObject({ from: 'Responsible for building', to: 'Built', rest: '  the billing run.' });
});

// ---------- The reviewer's lines: the only suggestion that can exist is the opening above, the rest byte-equal ----------
const REVIEW: [string, boolean, string | null][] = [
  ['Rarely ship the billing service on time before the move to Go.', false, null],
  ['Ship only the read path of the new quoting API in Go.', false, null],
  ['Move every service except billing to Go.', false, 'Moved every service except billing to Go.'],
  ['Keep the old queue despite the push to move to Kafka.', false, 'Kept the old queue despite the push to move to Kafka.'],
  ['Fail to ship the new billing service on time.', false, null],
  ['Choose Postgres instead of Kafka for the order store.', false, null],
  ['Run the old service until the move of billing to Go.', false, 'Ran the old service until the move of billing to Go.'],
  ['Lead the pilot of the new dispatch console for two depots.', false, 'Led the pilot of the new dispatch console for two depots.'],
  ['Write the proposed plan to move billing to Go.', false, 'Wrote the proposed plan to move billing to Go.'],
  ['Plan the move of billing to Go.', false, 'Planned the move of billing to Go.'],
  ['Build a draft prototype of the internal billing tool.', false, 'Built a draft prototype of the internal billing tool.'],
  ['Lead the interim on-call rota as a temporary trial.', false, 'Led the interim on-call rota as a temporary trial.'],
  ['Advise the team that built the billing service.', false, 'Advised the team that built the billing service.'],
  ['Review the design for the dispatch console.', false, 'Reviewed the design for the dispatch console.'],
  ['Train under the lead who shipped the quoting API.', false, null],
  ['Attempt to migrate billing to Go.', false, null],
  ['Begin to move billing to Go.', false, null],
  ['Start the move of billing to Go.', false, null],
  ['Learn Go while the team rebuilt the quoting API.', false, null],
  ['Review code the vendor wrote for the billing service.', false, null],
  ['Responsible for reviewing the vendor who rebuilt the quoting API.', true, 'Review the vendor who rebuilt the quoting API.'],
  ['Responsible for approving invoices built by the vendor.', true, null],
  ['Does not own the billing service but reviews its changes.', false, null],
  ['Worked on the billing rewrite.', true, null],
  ['Worked on the billing rewrite.', false, null],
  ['Involved in the migration of billing to Go.', false, null],
  ['Acted as backup on-call for the billing service.', false, null],
  ['Served as a member of the incident review group.', false, null],
  ['Tasked with testing.', false, null],
  ['Worked with the platform team on the billing rewrite.', false, null],
  ['Assisted in the move of billing to Go.', false, null],
  ['Helped to move billing to Go.', false, null],
  ['Lead the review of the billing service.', false, 'Led the review of the billing service.'],
  ['Own the plan for the move of billing to Go.', false, 'Owned the plan for the move of billing to Go.'],
  ['Write the test plan for the billing service.', false, 'Wrote the test plan for the billing service.'],
  ['Own the design review for the dispatch console.', false, 'Owned the design review for the dispatch console.'],
  ['Serve as lead engineer on the billing rewrite.', false, null],
  ['Write the news feed for the new users of billing.', false, 'Wrote the news feed for the new users of billing.'],
  ['Write docs in the style guide for one team.', false, null],
  ['Cut fees for the billing run.', false, null],
  ['Number the steps of the billing run.', false, null],
  ['Lead the review over two weeks.', false, 'Led the review over two weeks.'],
  ['Lead the billing rewrite, more or less on time.', false, 'Led the billing rewrite, more or less on time.'],
  ['Lead the billing rewrite for one team.', false, 'Led the billing rewrite for one team.'],
  ['Move the billing service for one company team to Go.', false, 'Moved the billing service for one company team to Go.'],
  ['Fix the vendor code in the billing service.', false, null],
  ['Build the API for the mobile team and the UI for the web team.', false, 'Built the API for the mobile team and the UI for the web team.'],
  ['Run 40 builds for the team every day.', false, 'Ran 40 builds for the team every day.'],
  ['Lead the review of the scheduler and the billing run.', false, 'Led the review of the scheduler and the billing run.'],
  ['Lead the review of the billing run with no outage.', false, 'Led the review of the billing run with no outage.'],
  ['Lead the billing rewrite after the outage.', false, 'Led the billing rewrite after the outage.'],
  ['Review the plan and build the scheduler.', false, 'Reviewed the plan and build the scheduler.'],
  ['Review the scheduler that Maria built for 12 depots.', false, 'Reviewed the scheduler that Maria built for 12 depots.'],
  ['Reduce p95 latency from 900 ms to 210 ms and errors from 40 to 12 a day.', false, null],
  ['Cut the queue from 900 jobs at peak to 210.', false, null],
  ['Reduce errors by 40% and the bill by 12 a day.', false, null],
  ['Lead the billing rewrite. Missed the deadline by two weeks.', false, 'Led the billing rewrite. Missed the deadline by two weeks.'],
  ['Lead the rebuild of the quoting API in Go with kubernetes-based deploys.', false, 'Led the rebuild of the quoting API in Go with kubernetes-based deploys.'],
  ['Lead the going-live of the quoting API.', false, 'Led the going-live of the quoting API.'],
  ['Lead the team’s rebuild of the quoting API.', false, 'Led the team’s rebuild of the quoting API.'],
  ['Lead the ﬁnance rebuild of the quoting API.', false, 'Led the ﬁnance rebuild of the quoting API.'],
];
test('each of the reviewer’s lines gets at most its new opening, with the rest of the line byte-equal', () => {
  const got = REVIEW.map(([line, current]) => [line, after(line, current).map(([n]) => n)]);
  expect(got).toEqual(REVIEW.map(([line, , want]) => [line, want === null ? [] : [want]]));
  for (const [line, current] of REVIEW) for (const [n] of after(line, current)) expect([line, restKept(line, n)]).toEqual([line, true]);
  expect(asked).toBe(0);
});

// ---------- The guards ----------
test('the guards: only the opening code gives passes, with the rest byte-equal and the facts moved unchanged', () => {
  const line = 'Lead the weekly incident review.', links: Links = { v: 1, lines: [{ where: 'bullet', entry: 'quillfeather labs', text: line, facts: [4], edited: 0 }] };
  const id = job(resumeOf([line]), { links }), j = row(id) as never;
  const c = (to: string, kind = 'tense') => guard(j, { where_: 'bullet', entry: '', kind: kind as never, old: `- ${line}`, new: `- ${to}`, why: '' });
  expect(c('Led the weekly incident review.')).toBe('');
  // Anything else: another word, another ending, a word more or less, another kind.
  expect(c('Ran the weekly incident review.')).toBe('record');
  expect(c('Led the incident review.')).toBe('record');
  expect(c('Led the weekly incident review, every week.')).toBe('record');
  expect(c('Led the weekly incident review.', 'verb')).toBe('record');
  expect(c(line)).toBe('old');
  // The facts of the line move to the new words unchanged.
  suggestAfterSave(id, 1);
  const s = sugs(id)[0];
  expect(decide(s.id, 'keep', 10)).toEqual({ ok: true, jobId: id, wrote: true });
  expect((JSON.parse(row(id).links) as Links).lines.map((l) => [l.text, l.facts])).toEqual([['Led the weekly incident review.', [4]]]);
});

test('Keep, Reject and Undo, as in 3a; a rejected opening is never made again', () => {
  const id = job(resumeOf(['Responsible for building the billing run.', 'Lead the weekly incident review.']));
  suggestAfterSave(id, 1);
  const [verb, tense] = sugs(id);
  expect([verb.kind, verb.source, tense.kind, tense.source]).toEqual(['verb', 'rule', 'tense', 'rule']);
  expect(decide(verb.id, 'keep', 10)).toEqual({ ok: true, jobId: id, wrote: true });
  expect(row(id).resume).toContain('- Built the billing run.');
  expect(row(id).edited).toBe(1);
  expect(decide(verb.id, 'undo', 11).ok).toBe(true);
  expect(row(id).resume).toContain('- Responsible for building the billing run.');
  expect(decide(tense.id, 'reject', 12).ok).toBe(true);
  suggestAfterSave(id, 13);
  expect(sugs(id).map((s) => [s.kind, s.status])).toEqual([['verb', 'open'], ['tense', 'rejected']]);
  // Drawn in place: the old words struck and the new after them, with the reason.
  const v = resumeView(id)!, r = v.rows.find((x) => x.text === 'Responsible for building the billing run.')!;
  expect(r.sugs[0].parts.map((p) => `${p.kind}:${p.text}`)).toEqual(['gone:Responsible for building', 'new:Built', 'same: the billing run.']);
  expect(r.notes[0]).toMatchObject({ kind: 'suggestion', lead: 'Suggestion', text: 'Opens with what you did: “Built”, in place of “Responsible for building”.' });
  // An edit of the line makes it stale: not shown, and it cannot be kept.
  db.run('UPDATE jobs SET resume = ? WHERE id = ?', [row(id).resume.replace('Responsible for building the billing run.', 'Responsible for building the billing run in Go.'), id]);
  expect(shownSuggestions(row(id) as never).filter((s) => s.kind === 'verb')).toEqual([]);
  expect(decide(verb.id, 'keep', 14).ok).toBe(false);
  expect(asked).toBe(0);
});

test('a dates line the owner changes to an ended range: after the Save, the bullet’s past tense is suggested', () => {
  // The owner's Save of an ended range: the bullet under it needs the past tense.
  const saved = job(resumeOf(['Lead the weekly incident review.'], NOW));
  expect(sugs(saved)).toEqual([]);
  db.run('UPDATE jobs SET resume = ? WHERE id = ?', [resumeOf(['Lead the weekly incident review.'], NOW.replace('Present', 'Jun 2024')), saved]);
  suggestAfterSave(saved, 1);
  expect(sugs(saved).filter((s) => s.kind === 'tense').map((s) => s.new)).toEqual(['- Led the weekly incident review.']);
  // A read makes nothing, and a second Save adds nothing.
  const before = sugs(saved);
  resumeView(saved);
  suggestAfterSave(saved, 2);
  expect(sugs(saved)).toEqual(before);
  // The pass after a role change runs over the bullets too, and finds nothing new here.
  seeRoles();
  expect(suggestAfterRoles(5)).toEqual([]);
});

test('no model is asked anywhere in the suggestion paths', () => {
  const id = job(resumeOf(['Responsible for building the billing run.', 'Lead the weekly incident review.']));
  suggestAfterSave(id, 1);
  suggestSkills(2);
  seeRoles();
  suggestAfterRoles(3);
  resumeView(id);
  for (const s of sugs(id)) decide(s.id, 'keep', 4);
  expect(asked).toBe(0);
  // The two modules that make suggestions import neither the model module nor the module that asks it for projects,
  // and call no ask().
  for (const f of ['suggest.ts', 'wording.ts']) {
    const src = readFileSync(join(import.meta.dir, f), 'utf8');
    expect([f, /from '\.\/(?:llm|propose)\.ts'/.test(src), /\bask\s*[<(]/.test(src)]).toEqual([f, false, false]);
  }
});

// ---------- The word after the changed verb must open what it acts on ----------
const NOUNS: [string, boolean][] = [
  ['Lead SRE for the billing service.', false], ['Lead QA for the mobile apps.', false], ['Lead on-call for billing.', false], ['Lead engineer for the billing rewrite.', false],
  ['Support lead for EMEA customers.', false], ['Support tickets triage for 3 products.', false], ['Design system for the web app, used by 40 engineers.', false],
  ['Design lead on the checkout redesign.', false], ['Test automation for the billing service.', false], ['Review board member for the API guild.', false],
  ['Work samples available on request.', false], ['Help desk support for 200 staff.', false], ['Plan sponsor reporting for HR.', false], ['Launch partner for the new SDK.', false],
  ['Partner success lead for EMEA.', false], ['Built dashboards for the support team.', true], ['Automated test suite for the billing service.', true],
  ['Integrated payments platform used by 3 apps.', true], ['Managed services team of 6.', true],
  ['Responsible for testing strategy.', false], ['Responsible for building maintenance.', false], ['Responsible for planning poker sessions.', false],
  ['Tasked with leading indicators report.', false], ['Responsible for designing and building the billing service.', false],
  ['Duties included building, testing and shipping the billing service.', false], ['Responsible for making coffee runs.', false], ['Responsible for operating costs of the platform.', false],
  ['Responsible for growing pains of the team.', false], ['Responsible for managing director reports.', false], ['Responsible for leading edge research.', false],
  ['Responsible for running costs.', false], ['Responsible for moving parts of the billing run.', false], ['Responsible for helping.', false],
  ['Duties include reviewing code.', true], ['Responsible for testing, and nothing else.', false], ['Responsible for training new hires.', false],
  // "that" after a noun starts a clause, and a number that is a label or a version is no count.
  ['Design that cut checkout drop-off by 12%.', false], ['Work that shipped in 3 releases.', false], ['Support that the sales team relied on.', false],
  ['Design 2.0 of the app, shipped to 40,000 users.', false], ['Lead 2 on the on-call rota.', false], ['Lead 24/7 on-call for billing.', false],
  ['Plan 2025 roadmap for the platform.', false], ['Review 360 feedback for the team.', false], ['Responsible for testing that the build works.', false],
];
test('a noun or an adjective after the changed verb, or a list of verbs: no suggestion, and the flag stays', () => {
  expect(NOUNS.map(([line, current]) => [line, after(line, current)])).toEqual(NOUNS.map(([line]) => [line, []]));
});
test('a determiner, a possessive or a number after the changed verb: the suggestion is made', () => {
  const KEPT: [string, boolean, string][] = [
    ['Lead the rebuild of the quoting API.', false, 'Led the rebuild of the quoting API.'],
    ['Led the billing rewrite.', true, 'Lead the billing rewrite.'],
    ['Lead a team of 6 engineers.', false, 'Led a team of 6 engineers.'],
    ['Manage our billing run.', false, 'Managed our billing run.'],
    ['Responsible for building the rail yard scheduler that runs 300 trains a day.', false, 'Built the rail yard scheduler that runs 300 trains a day.'],
    ['Responsible for helping the team ship the billing service.', false, 'Helped the team ship the billing service.'],
    ['Was responsible for running the on-call rota.', false, 'Ran the on-call rota.'],
    ['Responsible for training 4 new hires.', false, 'Trained 4 new hires.'],
    ['Charged with keeping all builds green.', false, 'Kept all builds green.'],
    ['Launch 3 products in 2 years.', false, 'Launched 3 products in 2 years.'],
    ['Manage 1,200 daily users of the console.', false, 'Managed 1,200 daily users of the console.'],
  ];
  expect(KEPT.map(([line, current]) => [line, after(line, current).map(([n]) => n)])).toEqual(KEPT.map(([line, , want]) => [line, [want]]));
});
