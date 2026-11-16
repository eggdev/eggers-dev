// `bun cloud/tools/seed.ts`: makes the FIRST backup of the studio's data from this machine, in the same form the
// container's keeper makes (cloud/lib/backup.ts), so the container has something to restore.
//
//   bun cloud/tools/seed.ts [--db <file>] [--codex-home <dir>] [--out <dir>] [--live] [--upload [--replace]]
//
//   --db <file>         the database; its folder is the data folder. Default: DB, else .data/egg.db
//   --codex-home <dir>  a Codex home whose sign-in (auth.json, config.toml) goes in the backup, so the container
//                       starts signed in. Optional.
//   --out <dir>         where the archive goes. Default: .data.seed/ (git ignores it). The folder mirrors the
//                       bucket: backups/<time>.tar.gz, backups/<time>.json, latest.json.
//   --live              take the copy while the server or worker runs. The copy is consistent either way
//                       (VACUUM INTO); without --live the tool refuses while they run, to be safe.
//   --upload            put the archive, its manifest and then latest.json in the bucket, with wrangler's sign-in
//                       (needs CLOUDFLARE_ACCOUNT_ID). Without it, nothing leaves this machine.
//   --replace           upload even when the bucket already has a pointer (a backup to restore). The new backup
//                       must pass the shrink guard against the pointer's, unless EGG_ALLOW_SHRINK=1.
//
// It prints sizes and the number of roles, facts and jobs. It never prints any content.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { prepareBackup } from '../lib/backup.ts';
import { manifestKey, POINTER, type DbStats } from '../lib/manifest.ts';
import { putObject, readPointer, ready, REPO, stop as fail, WRANGLER_PUT_LIMIT } from './r2.ts';

const stop = (m: string): never => fail('seed', m);
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function value(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) stop(`${name} needs a value.`);
  return v;
}
const KNOWN = new Set(['--db', '--codex-home', '--out', '--live', '--upload', '--replace']);
for (let i = 0; i < args.length; i++) {
  if (!KNOWN.has(args[i]!)) stop(`unknown argument "${args[i]}". Usage: bun cloud/tools/seed.ts [--db <file>] [--codex-home <dir>] [--out <dir>] [--live] [--upload [--replace]]`);
  if (['--db', '--codex-home', '--out'].includes(args[i]!)) i++;
}

const db = resolve(value('--db') ?? process.env.DB ?? join(REPO, '.data', 'egg.db'));
const codexHome = value('--codex-home') ? resolve(value('--codex-home')!) : null;
const out = resolve(value('--out') ?? join(REPO, '.data.seed'));
const upload = flag('--upload');
if (!existsSync(db)) stop(`there is no database at ${db}.`);
if (codexHome && !existsSync(join(codexHome, 'auth.json'))) stop(`${codexHome} has no auth.json: that Codex home is not signed in.`);
if (out === dirname(db) || out.startsWith(`${dirname(db)}/`)) stop('--out must not be inside the data folder.');
if (upload) ready('seed');

/** This process and every process above it (the shells that started it, whose command lines may name the text). */
function ancestors(): Set<number> {
  const seen = new Set<number>([process.pid]);
  let pid = process.ppid;
  while (pid > 1 && !seen.has(pid) && seen.size < 64) {
    seen.add(pid);
    pid = Number(Bun.spawnSync(['ps', '-o', 'ppid=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString().trim()) || 0;
  }
  return seen;
}
function running(text: string): boolean {
  const found = Bun.spawnSync(['pgrep', '-f', text], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString();
  const self = ancestors();
  return found.split('\n').some((line) => line.trim() !== '' && !self.has(Number(line.trim())));
}

const live = ['bun server.ts', 'bun worker.ts'].filter(running);
if (live.length && !flag('--live')) {
  stop(`${live.join(', ')} ${live.length === 1 ? 'is' : 'are'} running. Stop ${live.length === 1 ? 'it' : 'them'}, or pass --live to copy while the app runs (the copy is consistent). Nothing was written.`);
}

// Before anything is uploaded: the pointer already in the bucket, if any.
// The shrink guard compares the new backup with it, as the keeper does.
let last: DbStats | null = null;
if (upload) {
  let pointer;
  try {
    pointer = readPointer();
  } catch (error) {
    stop(`the bucket could not be checked (${(error as Error).message}). Nothing was uploaded.`);
  }
  if (pointer && !flag('--replace')) {
    stop(`the bucket already has a backup to restore (${pointer.key}, ${pointer.db.roles} roles, ${pointer.db.facts} facts). `
      + 'Pass --replace to put this one in its place. Nothing was uploaded.');
  }
  last = pointer?.db ?? null;
}

const r = await prepareBackup({
  layout: { db, codexHome },
  work: join(out, '.work'),
  from: 'seed',
  last,
  allowShrink: process.env.EGG_ALLOW_SHRINK === '1',
  now: Date.now(),
});
if (r.kind === 'refused') stop(r.reason);
const { manifest } = r.prepared;
if (r.prepared.warning) console.log(`seed: WARNING: ${r.prepared.warning}`);

// The bucket's layout, on this machine.
const archive = join(out, ...manifest.key.split('/'));
const manifestFile = join(out, ...manifestKey(manifest.key).split('/'));
mkdirSync(dirname(archive), { recursive: true });
copyFileSync(r.prepared.file, archive);
rmSync(join(out, '.work'), { recursive: true, force: true });
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
const pointerFile = join(out, POINTER);
writeFileSync(pointerFile, JSON.stringify(manifest, null, 2));

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`seed: database ${mb(manifest.db.bytes)} (consistent copy); ${manifest.db.roles} roles, ${manifest.db.facts} facts, ${manifest.db.jobs} jobs`);
console.log(`seed: archive ${mb(manifest.size)}, ${manifest.files} files${codexHome ? ', with the Codex sign-in' : ', without a Codex sign-in'}`);
console.log(`seed: written to ${archive}`);

if (!upload) {
  console.log(`seed: nothing was uploaded. With --upload, this puts ${manifest.key}, then ${manifestKey(manifest.key)}, then ${POINTER} in the bucket.`);
  process.exit(0);
}
if (manifest.size > WRANGLER_PUT_LIMIT) {
  stop(`the archive is ${mb(manifest.size)}; \`wrangler r2 object put\` takes at most 300 MiB. Upload it in parts another way (an S3 client with multipart upload), or let the container start empty (EGG_ALLOW_EMPTY=1) and move the data over in it.`);
}
try {
  putObject(manifest.key, archive, 'application/gzip');
  putObject(manifestKey(manifest.key), manifestFile, 'application/json');
  // The pointer last: until it is written, the container does not restore this backup.
  putObject(POINTER, pointerFile, 'application/json');
} catch (error) {
  stop(`${(error as Error).message}. latest.json is written last, so the container still restores what it restored before.`);
}
console.log(`seed: uploaded. The container restores ${manifest.key} on its next start.`);
