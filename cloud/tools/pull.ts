// `bun cloud/tools/pull.ts`: downloads the newest backup of the studio's data (the one latest.json names) into a
// NEW folder on this machine and checks it, so local tools can run against a copy of the cloud's data. It never
// writes into .data/.
//
//   bun cloud/tools/pull.ts [--into <dir>] [--from <dir>]
//
//   --into <dir>  where the copy goes; it must not exist yet. Default: .data.cloud/<backup time>/ (git ignores it)
//   --from <dir>  read a folder in the bucket's layout (latest.json, backups/...) instead of the bucket, such as
//                 the .data.seed/ folder seed.ts writes. Without it: the bucket, with wrangler's sign-in
//                 (needs CLOUDFLARE_ACCOUNT_ID).
//
// The copy is checked as the container checks a restore: the checksum, the archive's paths, SQLite's integrity
// check and the row counts. Use it with DB=<dir>/egg.db. It holds the Codex sign-in too (codex/), when the backup
// has one.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { placeUnpacked } from '../lib/archive.ts';
import { parseManifest, POINTER, type Manifest } from '../lib/manifest.ts';
import { verifyArchive } from '../lib/restore.ts';
import { getObject, readPointer, ready, REPO, stop as fail } from './r2.ts';

const stop = (m: string): never => fail('pull', m);
const args = process.argv.slice(2);
function value(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) stop(`${name} needs a value.`);
  return v;
}
for (let i = 0; i < args.length; i += 2) {
  if (args[i] !== '--into' && args[i] !== '--from') stop(`unknown argument "${args[i]}". Usage: bun cloud/tools/pull.ts [--into <dir>] [--from <dir>]`);
}
const from = value('--from') ? resolve(value('--from')!) : null;
if (!from) ready('pull');

// 1. The manifest of the backup to restore.
let manifest: Manifest | null;
if (from) {
  const file = join(from, POINTER);
  if (!existsSync(file)) stop(`${from} has no ${POINTER}.`);
  manifest = parseManifest(JSON.parse(readFileSync(file, 'utf8')));
  if (!manifest) stop(`${file} is not a manifest.`);
} else {
  try {
    manifest = readPointer();
  } catch (error) {
    stop(`the bucket could not be read (${(error as Error).message}).`);
  }
  if (!manifest) stop('the bucket has no backup to restore yet (no latest.json).');
}
const m = manifest!;

// 2. Where the copy goes: a new folder, never the live data folder.
const stamp = m.key.replace(/^backups\//, '').replace(/\.tar\.gz$/, '');
const into = resolve(value('--into') ?? join(REPO, '.data.cloud', stamp));
const live = join(REPO, '.data');
if (into === live || into.startsWith(live + sep)) stop('the copy may not go into .data/, the data the app on this machine uses.');
if (existsSync(into)) stop(`${into} already exists. Name a new folder with --into.`);

// 3. Download, check, and move into place.
const work = mkdtempSync(join(tmpdir(), 'egg-pull-'));
try {
  const archive = join(work, 'backup.tar.gz');
  if (from) {
    const src = join(from, ...m.key.split('/'));
    if (!existsSync(src)) stop(`${src} is missing.`);
    Bun.spawnSync(['cp', src, archive]);
  } else {
    console.log(`pull: downloading ${m.key} (${(m.size / 1024 / 1024).toFixed(1)} MB)`);
    try {
      if (!getObject(m.key, archive)) stop(`latest.json names ${m.key}, but the bucket does not have it.`);
    } catch (error) {
      stop((error as Error).message);
    }
  }
  const unpacked = join(work, 'unpacked');
  try {
    await verifyArchive(archive, m, unpacked);
  } catch (error) {
    stop(`the backup did not pass its checks: ${(error as Error).message}. Nothing was written.`);
  }
  placeUnpacked(unpacked, { db: join(into, 'egg.db'), codexHome: join(into, 'codex') });
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`pull: ${m.key} is in ${into}: ${m.db.roles} roles, ${m.db.facts} facts, ${m.db.jobs} jobs, ${m.files} files.`);
console.log(`pull: use it with DB=${join(into, 'egg.db')}`);
