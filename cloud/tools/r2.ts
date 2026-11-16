// The bucket from the owner's machine, through wrangler (studio/node_modules) and its own sign-in. Used by seed.ts
// and pull.ts. Nothing here prints an object's content.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseManifest, POINTER, type Manifest } from '../lib/manifest.ts';

export const REPO = resolve(import.meta.dir, '..', '..');
export const BUCKET = 'eggers-studio-data';
const STUDIO = join(REPO, 'studio');
const WRANGLER = join(STUDIO, 'node_modules', '.bin', 'wrangler');
// `wrangler r2 object put` refuses a file over 300 MiB (MAX_UPLOAD_SIZE_BYTES in wrangler 4.155).
export const WRANGLER_PUT_LIMIT = 300 * 1024 * 1024;

export function stop(tool: string, message: string): never {
  console.error(`${tool}: ${message}`);
  process.exit(1);
}

/** Checks what every bucket command needs: wrangler installed and an account named. */
export function ready(tool: string) {
  if (!existsSync(WRANGLER)) stop(tool, 'wrangler is not installed. Run `bun install` in studio/ first.');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) stop(tool, 'set CLOUDFLARE_ACCOUNT_ID to the Cloudflare account that holds the bucket.');
}

function wrangler(args: string[]) {
  const r = Bun.spawnSync([WRANGLER, ...args], { cwd: STUDIO, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const NOT_FOUND = /does not exist|NoSuchKey|not found|404/i;

/** Downloads one object to a file. Answers false when the bucket says the object is not there; throws otherwise. */
export function getObject(key: string, file: string): boolean {
  const r = wrangler(['r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--file', file]);
  if (r.code === 0) return true;
  if (NOT_FOUND.test(r.err + r.out)) return false;
  throw new Error(`wrangler r2 object get ${key} failed (exit ${r.code}): ${(r.err || r.out).trim().split('\n').slice(-3).join(' ')}`);
}

/** Uploads one file to a key. */
export function putObject(key: string, file: string, contentType: string): void {
  const r = wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--remote', '--file', file, '--content-type', contentType]);
  if (r.code !== 0) throw new Error(`wrangler r2 object put ${key} failed (exit ${r.code}): ${(r.err || r.out).trim().split('\n').slice(-3).join(' ')}`);
}

/** The manifest latest.json holds, or null when the bucket has no pointer. */
export function readPointer(): Manifest | null {
  const dir = mkdtempSync(join(tmpdir(), 'egg-pointer-'));
  try {
    const file = join(dir, 'latest.json');
    if (!getObject(POINTER, file)) return null;
    const m = parseManifest(JSON.parse(readFileSync(file, 'utf8')));
    if (!m) throw new Error('latest.json in the bucket is not a manifest');
    return m;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
