// `bun test lib`: numbers in context (lib/numbers.ts). What is sent to a model has each number that no fact of the
// project holds strictly replaced by "[number]"; the check after writing then flags a number whose value stands in the
// context and in no fact, by value alone. Each case is taken from a review of the earlier, noun-matching rule: a false
// alarm that is quiet now, or a copy that is still caught. Everything is invented.
import { expect, test } from 'bun:test';
import { counts, quantities, redact, unsupported } from './numbers.ts';

test('redaction: a number no fact of the project holds strictly becomes [number]; one it holds stays; names stay', () => {
  const held = quantities('Built the dispatch console that schedulers use every day. 640 users across 12 depots');
  expect(redact('Schedulers planned 35 depots on paper; the console reached 640 users in 12 depots.', held))
    .toBe('Schedulers planned [number] depots on paper; the console reached 640 users in 12 depots.');
  // Strict: the same value counting another thing, or written with another unit, is taken out.
  expect(redact('640 drivers, 640% more, $640, 3x faster.', held)).toBe('[number] drivers, [number] more, [number], [number] faster.');
  // Number words, separators, scales and money are read as numbers too.
  expect(redact('Thirty-five depots, 1,400 drivers, 1.4k riders, a $1.4 million budget, a hundred tests.', [])).toBe('[number] depots, [number] drivers, [number] riders, a [number] budget, [number] tests.');
  // Names, versions, standards and ratios are not counts, and stay readable.
  // A version is no name here: redaction needs no versions, so "Python 3.12" is sent as "Python [number]".
  expect(redact('Moved files to S3 on EC2, passed SOC 2 and ISO 27001, served HTTP/2, ran Python 3.12, kept 24/7 support, read p95.', []))
    .toBe('Moved files to S3 on EC2, passed SOC 2 and ISO 27001, served HTTP/2, ran Python [number], kept 24/7 support, read p95.');
  // A kept line is sent with every number taken out.
  expect(redact('Your record shows you managing, hiring or growing a team in 2 of 3 roles.')).toBe('Your record shows you managing, hiring or growing a team in [number] of [number] roles.');
  // "one" stays a word.
  expect(redact('One console for every depot.')).toBe('One console for every depot.');
});

test('the check reads values alone: separators, scales, percent, money and words, with noise and names gone', () => {
  const v = (text: string, _years = false) => counts(text).map((x) => x.value);
  expect(v('1,400 and 1400 and 1.4k and 1.4 thousand; $1.4M, $1.4 million, $1,400,000; 31% and 31 percent; thirty-five; 3x')).toEqual([1400, 1400, 1400, 1400, 1400000, 1400000, 1400000, 31, 31, 35, 3]);
  expect(counts('SOC 2, ISO 27001, HTTP 200, OAuth 2.0, Node 20, Windows 11, iOS 17, 24/7, Q3 2024, FY24, S3, EC2, 2FA, p99, 3rd, since 2016', { versions: ['Node.js', 'Windows', 'iOS'] })).toEqual([]);
  expect(v('Engineer with 10 years, 12+ yrs, over 3 years, since 2016.', true)).toEqual([]);
  expect(v('Engineer with 10 depots.')).toEqual([10]);
});

// [what the bullet says, the context as stored, what the facts say] → the numbers flagged.
const flag = (text: string, context: string, stated: string, _years = false, versions: string[] = []) => unsupported(text, context, stated, { versions });

test('every false alarm of the noun rule is quiet', () => {
  expect(flag('Led 3 engineers through the quoting rewrite.', 'A plan in 3 parts.', 'Led 3 junior engineers through the rewrite.')).toEqual([]);
  expect(flag('Led a team of 3 through the rewrite.', 'A plan in 3 parts.', 'Led 3 junior engineers through the rewrite.')).toEqual([]);
  expect(flag('Cut the nightly billing run from 6 hrs to 40 min.', 'It took 6 hours, now 40 minutes.', 'Cut the nightly billing run from 6 hours to 40 minutes.')).toEqual([]);
  expect(flag('Cut the 6h run to 40min.', 'It took 6 hours, now 40 minutes.', 'from 6 hours to 40 minutes')).toEqual([]);
  expect(flag('Opened 35 regional depots.', 'Schedulers planned 35 depots on paper.', 'Rolled out the console to 35 depots.')).toEqual([]);
  expect(flag('Led a 12-person team.', 'A team of 12 people.', 'Led 12 people.')).toEqual([]);
  expect(flag('Built a console for 640 daily users.', 'Result: 640 users.', '640 users across 12 depots')).toEqual([]);
  expect(flag('Made billing 3x faster.', '3 times faster.', 'Made billing 3 times faster.')).toEqual([]);
  // "Node 20" and "Windows 11" are versions because the person lists Node.js and Windows among their platforms.
  for (const name of ['Led SOC 2 compliance.', 'Led ISO 27001 certification.', 'Returned HTTP 200 on every call.', 'Moved sign-in to OAuth 2.0.', 'Moved to Node 20.', 'Rolled out Windows 11.', 'Ran 24/7 support.', 'Launched in Q3 2024.'])
    expect([name, flag(name, '2 regions, 200 depots, 27001 rows, 20 depots, 11 offices, 24 depots, 2024 plans.', '', false, ['Node.js', 'Windows'])]).toEqual([name, []]);
  expect(flag('Building logistics software since 2016.', 'In 2016 we started.', '', true)).toEqual([]);
  expect(flag('Engineer with 10 yrs in logistics.', '10 depots.', '', true)).toEqual([]);
});

test('a number from context that no fact holds in any form is still caught', () => {
  expect(flag('Replaced paper planning in 35 depots.', 'Schedulers planned 35 depots on paper.', 'Cut support calls.')).toEqual(['35']);
  expect(flag('Served 1.4k drivers.', 'Served 1,400 drivers.', '')).toEqual(['1.4k']);
  expect(flag('Served thirty-five depots.', 'Planned 35 depots.', '')).toEqual(['thirty-five']);
  expect(flag('Ran a $1.4 million budget.', 'A $1.4M budget.', '')).toEqual(['$1.4 million']);
  // A number a fact holds in another form is quiet: the fact has the value.
  expect(flag('Replaced paper planning in 35 depots.', 'Schedulers planned 35 depots on paper.', '35% fewer calls')).toEqual([]);
});

// ---------- Third review ----------

test('redaction keeps a number only with the same non-empty noun, or the same phrase; with no noun it is taken out', () => {
  // The same value and unit with no noun on either side is no longer enough.
  expect(redact('20% of drivers quit each year.', quantities('Cut hosting costs by 20%. 20% lower hosting costs'))).toBe('[number] of drivers quit each year.');
  expect(redact('Took 12 of the depots live.', quantities('Brought 12 depots onto the console. team of 12'))).toBe('Took [number] of the depots live.');
  // The same noun still keeps it, and so does the same phrase.
  expect(redact('The console reached 640 users.', quantities('640 users across 12 depots'))).toBe('The console reached 640 users.');
  expect(redact('Hosting fell 20% of the bill.', quantities('Hosting fell 20% of the bill.'))).toBe('Hosting fell 20% of the bill.');
});

test('"go 6 weeks" and "35/40 depots" are counts; real names stay names', () => {
  expect(redact('Releases would go 6 weeks apart. We reached 35/40 depots.')).toBe('Releases would go [number] weeks apart. We reached [number]/[number] depots.');
  expect(unsupported('Shipped every 6 weeks.', 'Releases would go 6 weeks apart.', '')).toEqual(['6']);
  expect(unsupported('Rolled out to 35 of 40 depots.', 'We reached 35/40 depots.', '')).toEqual(['35', '40']);
  // Names that need no guess stay readable; a version is sent as "[number]" (redaction needs none), and in the check it is
  // no count after one of the person's tools.
  const names = 'Ran S3, EC2, p95, 2FA, FY24, the 3rd release, SOC 2, ISO 27001, HTTP 200, HTTP/2, OAuth 2.0, Go 1.21, Python 3.12, Node 20, 24/7 and 9/80 schedules.';
  expect(redact(names)).toBe(names.replace('Go 1.21', 'Go [number]').replace('Python 3.12', 'Python [number]').replace('Node 20', 'Node [number]'));
  expect(unsupported(names, '3 2 27001 200 1.21 3.12 20 24 7 9 80 2.0 95 21', '', { versions: ['Node.js', 'Go', 'Python'] })).toEqual([]);
});

test('letters glued to a number are what it counts, unless the token is a name', () => {
  expect(redact('It took 8hours, 12months and 35depots.')).toBe('It took [number]hours, [number]months and [number]depots.');
  expect(unsupported('Cut the run from 8 hours.', 'It took 8hours.', '')).toEqual(['8']);
  expect(redact('Ran 2FA, 3D views and the 4G network.')).toBe('Ran 2FA, 3D views and the 4G network.');
});

test('a count of years is no project number, in a bullet too; a number word joined to a word is a name', () => {
  expect(unsupported('Ran the desk for 5 years.', 'I ran it 5 years.', '')).toEqual([]);
  for (const name of ['Added two-factor sign-in.', 'Split a three-tier app.', 'Held one-on-one reviews.', 'Moved to first-party data.'])
    expect([name, unsupported(name, '1 2 3', '')]).toEqual([name, []]);
  expect(unsupported('Led a 12-person team across 35-depot regions.', '12 people in 35 depots.', '')).toEqual(['12', '35']);
});

test('both functions take linear time: a 100,000-character text in well under a second', () => {
  const texts = ['In week 3 we moved 35 depots and 12 drivers. '.repeat(2200).slice(0, 100_000), `1,${'000,'.repeat(25_000)}`, '1-'.repeat(50_000), 'twenty one hundred thousand '.repeat(3_700)];
  // Measured in this process's own processor time, so another test run on the same machine does not make it fail.
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  for (const t of texts) {
    const at = cpu();
    redact(t);
    unsupported(t, t, 'nothing');
    expect([t.slice(0, 20), cpu() - at < 500]).toEqual([t.slice(0, 20), true]);
  }
  // The bound is the processor time above; the wall-clock limit is only for a machine busy with other work.
}, 60_000);

test('what lib/metrics.ts already exported returns what it did before', async () => {
  const { numbersIn, inventory } = await import('./metrics.ts');
  const strs = ['Cut the run from 6 hours to 40 minutes', '640 users across 12 depots', '$1.4M saved, 31 percent, 3x faster', 'p95 latency 900 ms to 210 ms', 'Python 3.12 and Node 20, SOC 2, ISO 27001, HTTP 200', 'In 2019 to Mar 2021, 24/7, 1,400,000 riders', 'team of 6 people', 'Wrote 212 tests, 40% coverage, 3 days ago', 'twelve teams and two hundred users', '', '99.9% uptime', '$40k per seat', 'go 6 weeks'];
  expect(strs.map((s) => numbersIn(s))).toEqual([['6', '40'], ['640', '12'], ['$1.4m', '31%', '3x'], ['900', '210'], [], ['1400000'], ['6'], [], ['12', '2'], [], ['99.9%'], ['$40k'], []]);
  expect(inventory(strs.map((m, i) => ({ id: i + 1, role_id: (i % 3) + 1, metric: m }))).map((m) => [m.fact, m.kind, m.tokens]))
    .toEqual([[1, 'time saved', ['6', '40']], [2, 'users', ['640', '12']], [3, 'revenue', ['$1.4m', '31%', '3x']], [4, 'latency', ['900', '210']], [7, 'team size', ['6']], [9, 'adoption', ['12', '2']]]);
});

// ---------- Final review ----------

test('a number with no word after it is taken out, even when a fact ends on the same number; equal words after it keep it', () => {
  expect(redact('Attrition fell 20%.', quantities('Cut hosting costs by 20%.'))).toBe('Attrition fell [number].');
  expect(redact('Hosting cost $40k.', quantities('Saved $40k.'))).toBe('Hosting cost [number].');
  expect(redact('The queue sat at 400.', quantities('Cut the queue to 400.'))).toBe('The queue sat at [number].');
  expect(redact('Hosting fell 20% of the bill.', quantities('Cut it 20% of the bill.'))).toBe('Hosting fell 20% of the bill.');
});

test('a plain number after a capitalised word is taken out wherever it stands in a list; a dotted version stays', () => {
  expect(redact('Depots by city: Dallas 12, Austin 9, Denver 14.')).toBe('Depots by city: Dallas [number], Austin [number], Denver [number].');
  expect(redact('We run Python 3.12. We moved to Go 1.21 and Windows 11.')).toBe('We run Python [number]. We moved to Go [number] and Windows [number].');
  // A sentence's first word is no name: a decimal after it is a count.
  expect(redact('Cut 3.5 hours from the run.')).toBe('Cut [number] hours from the run.');
  expect(unsupported('Cut 3.5 hours from the run.', 'It took 3.5 hours.', '')).toEqual(['3.5']);
});

test('the check: a number after a place name is a count; a version after one of the person\'s tools is not', () => {
  expect(flag('Opened 14 depots in Denver.', 'Depots by city: Dallas 12, Austin 9, Denver 14.', 'Built the dispatch console.')).toEqual(['14']);
  expect(flag('Denver 14 opened in spring.', 'Depots by city: Dallas 12, Austin 9, Denver 14.', '')).toEqual(['14']);
  expect(flag('Moved to Node 20 and Python 3.12.', 'Release 20 and 3.12 depots.', '', false, ['Node.js', 'Python'])).toEqual([]);
  // After a tool the person lists, a version is quiet; after any other capitalised word, dotted or not, it is a count.
  expect(flag('Moved to Go 1.21.', 'In 1.21 days.', '', false, ['Go'])).toEqual([]);
  expect(flag('Moved to Go 1.21.', 'In 1.21 days.', '')).toEqual(['1.21']);
  expect(flag('Rolled out Windows 11.', '11 offices.', '')).toEqual(['11']);
});

test('a dotted number after a capitalised word is no version by itself: it is redacted, and a copy is caught', () => {
  for (const [text, sent] of [['Region East 2.5 hours behind.', 'Region East [number] hours behind.'], ['The run for Billing 3.5 hours long.', 'The run for Billing [number] hours long.'], ['(Billing 3.5)', '(Billing [number])']])
    expect(redact(text)).toBe(sent);
  expect(flag('Cut lag by 2.5 hours.', 'Region East 2.5 hours behind.', 'Built the dispatch console.')).toEqual(['2.5']);
  // A version in a bullet whose tool is not among the person's skills is quiet when a fact holds the value.
  expect(flag('Moved the console to Python 3.12.', 'Release 3.12 planned.', 'Upgraded the console to 3.12.')).toEqual([]);
  // The names that need no guess stay readable and quiet.
  for (const name of ['Moved files to S3 on EC2.', 'Read p95 and added 2FA.', 'Passed SOC 2 and ISO 27001.', 'Served HTTP 200 over HTTP/2.', 'Moved to OAuth 2.0.', 'Ran 24/7 and 9/80 schedules.']) {
    expect(redact(name)).toBe(name);
    expect([name, flag(name, '3 2 95 27001 200 2.0 24 7 9 80', '')]).toEqual([name, []]);
  }
});
