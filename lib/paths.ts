// Where the person's data lives: the database, the inbox, cloned repositories and the profile file.
// It is a dot folder (.data) because the app build scans every other folder beside app.contract,
// and a cloned repository's symbolic links stop that build. An install that still has the older
// data/ folder keeps using it until it is renamed (stop the server and worker, then `mv data .data`).
//
// Under `bun test` (it sets NODE_ENV to "test") with no DB given, the database is a new file in the
// system's temporary folder. A unit test can therefore never open or change the person's real data,
// whichever test file happens to load this module first.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const legacy = !existsSync('.data') && existsSync('data/egg.db');
// The scratch folder is removed when the test run ends.
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'egg-test-')); process.on('exit', () => rmSync(dir, { recursive: true, force: true })); return join(dir, 'egg.db'); };
export const DB_FILE = process.env.DB ?? (process.env.NODE_ENV === 'test' ? scratch() : legacy ? 'data/egg.db' : '.data/egg.db');
export const DATA_DIR = dirname(resolve(DB_FILE));
export const inData = (name: string) => join(DATA_DIR, name);
