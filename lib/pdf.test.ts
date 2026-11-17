// `bun test lib`: the extra Chrome arguments from EGG_CHROME_ARGS, and the parse test of rule 11 on a real
// PDF. The PDF test prints one small invented resume, and only where a Chrome or Chromium is found by the
// same search the server uses (lib/pdf.ts): with no browser it is skipped. The comparison itself is also
// tested on plain text, with no browser, in lib/resume.test.ts.
import { expect, test } from 'bun:test';
import { atsCheck, chrome, chromeArgs, renderPdf, resumeHtml } from './pdf.ts';

test('EGG_CHROME_ARGS is split on spaces, and unset adds nothing', () => {
  expect(chromeArgs('')).toEqual([]);
  expect(chromeArgs('   ')).toEqual([]);
  expect(chromeArgs('--no-sandbox  --disable-dev-shm-usage\n')).toEqual(['--no-sandbox', '--disable-dev-shm-usage']);
});

const RESUME = `# Avery Lindqvist
Duluth, MN · avery@lindqvist.example · (218) 555-0142

## Summary
Engineer with 14 years building logistics software in TypeScript and Go. Built a dispatch console for 640 users.

## Experience
### Director, Software Engineering, Harborlight Systems
Mar 2021 – Present · Own company · Remote
Sole engineer: designs, builds and runs every system below.
- Build the forward-deployed dispatch console that 640 users across 12 depots open every day.
- Cut the nightly billing run from 6 hours to 40 minutes with Go and PostgreSQL.

### Senior Engineer, Quillfeather Labs
Jan 2019 – Feb 2021 · Duluth, MN
Previously Engineer, Jan 2016 – Dec 2018
- Rebuilt the quoting API in Go, taking p95 latency from 900 ms to 210 ms.

## Earlier experience
Support Lead, Tessellate Freight (2010 – 2012)

## Skills
TypeScript, Go, PostgreSQL

## Education
BSc Computer Science, Lakehead Polytechnic
`;
const COMPANIES = ['Harborlight Systems', 'Quillfeather Labs', 'Tessellate Freight'];

test('the printed page keeps one column, the context line and the Earlier experience section', () => {
  const html = resumeHtml(RESUME, 1, COMPANIES);
  expect(html).toContain('<h3>Director, Software Engineering</h3>\n<p class="when">Harborlight Systems | Mar 2021 - Present | Own company | Remote</p>\n<p>Sole engineer: designs, builds and runs every system below.</p>');
  expect(html).toContain('<p>Previously Engineer, Jan 2016 – Dec 2018</p>');
  expect(html).toContain('<h2>Earlier experience</h2>\n<p>Support Lead, Tessellate Freight (2010 – 2012)</p>');
  expect(html).not.toMatch(/<table|<img|column-count|float:/);
});

test.skipIf(!chrome())('the parse test passes on a PDF printed from an invented resume', async () => {
  const pdf = await renderPdf(RESUME, 1, COMPANIES);
  const check = await atsCheck(pdf, RESUME, { inResume: ['Go'], inBankOnly: [], missing: [] }, 1, [], COMPANIES);
  const line = (label: string) => check.lines.find((l) => l.label === label)!;
  expect(line('Reading order')).toEqual({ label: 'Reading order', ok: true, note: 'The name, the section headers, each role and each bullet read back in the order you wrote them.' });
  expect(line('Standard sections')).toMatchObject({ ok: true, note: 'Found, in order: Summary, Experience, Earlier experience, Skills, Education.' });
  expect(line('Text reads back').ok).toBe(true);
  expect(check.pages).toBe(1);
  // The same file fails the test when it is compared with a resume whose bullets are in another order.
  const swapped = RESUME.replace(/(- Build the forward-deployed[^\n]*\n)(- Cut the nightly[^\n]*\n)/, '$2$1');
  const wrong = await atsCheck(pdf, swapped, { inResume: [], inBankOnly: [], missing: [] }, 1, [], COMPANIES);
  expect(wrong.lines.find((l) => l.label === 'Reading order')).toMatchObject({ ok: false });
  expect(wrong.ok).toBe(false);
}, 120_000);
