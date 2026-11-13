// Where the person's data lives: the database, the inbox, cloned repositories and the profile file.
// It is a dot folder (.data) because the app build scans every other folder beside app.contract,
// and a cloned repository's symbolic links stop that build. An install that still has the older
// data/ folder keeps using it until it is renamed (stop the server and worker, then `mv data .data`).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const legacy = !existsSync('.data') && existsSync('data/egg.db');
export const DB_FILE = process.env.DB ?? (legacy ? 'data/egg.db' : '.data/egg.db');
export const DATA_DIR = dirname(resolve(DB_FILE));
export const inData = (name: string) => join(DATA_DIR, name);
