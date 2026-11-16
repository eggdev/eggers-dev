// `bun test lib`: the extra Chrome arguments from EGG_CHROME_ARGS. Nothing here prints a PDF.
import { expect, test } from 'bun:test';
import { chromeArgs } from './pdf.ts';

test('EGG_CHROME_ARGS is split on spaces, and unset adds nothing', () => {
  expect(chromeArgs('')).toEqual([]);
  expect(chromeArgs('   ')).toEqual([]);
  expect(chromeArgs('--no-sandbox  --disable-dev-shm-usage\n')).toEqual(['--no-sandbox', '--disable-dev-shm-usage']);
});
