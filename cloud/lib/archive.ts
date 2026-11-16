// The backup archive: one gzipped tar file with the database, the data folder's files and the Codex sign-in.
//
//   egg.db            a consistent copy of the database (VACUUM INTO), whatever the file is called on disk
//   <the data folder's other files and folders, at the same paths>: inbox/, resumes/, profile.md, public/, ...
//   codex/auth.json   the Codex sign-in, and codex/config.toml when there is one
//
// Left out: repos/ (cloned repositories, cloned again when needed), the database's own files (the copy replaces
// them: egg.db, -wal, -shm, -journal) and the app's earlier copies of it (egg.db.before-*), symbolic links, and any
// file whose name ends in -wal, -shm or -journal. The keeper, cloud/tools/seed.ts and cloud/tools/pull.ts all use
// this file, so every archive has the same form.
//
// tar is the system's own (GNU tar in the container, bsdtar on macOS); both read and write this form.
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const DB_IN_ARCHIVE = 'egg.db';
export const CODEX_IN_ARCHIVE = 'codex';
// Only these files of the Codex home are kept: the sign-in and the settings. Logs and session records are not.
export const CODEX_FILES = ['auth.json', 'config.toml'];
const SKIP_TOP = new Set(['repos']);
const SQLITE_SIDE = /-(wal|shm|journal)$/;

export type Layout = {
  /** The database file (DB). The data folder is its folder. */
  db: string;
  /** The Codex home (CODEX_HOME), or null for none. It may be inside the data folder (data/codex) or elsewhere. */
  codexHome: string | null;
  /** Folders to leave out wherever they are: the keeper's own work folder, when it is under the data folder. */
  skip?: string[];
};

export type Entry = { abs: string; rel: string; size: number; mtimeMs: number };

/** Every file a backup holds, except the database itself, with its path inside the archive. Sorted by path. */
export function filesToKeep(layout: Layout): Entry[] {
  const dataDir = dirname(resolve(layout.db));
  const dbName = basename(layout.db);
  const codexHome = layout.codexHome ? resolve(layout.codexHome) : null;
  const skip = new Set((layout.skip ?? []).map((p) => resolve(p)));
  const out: Entry[] = [];

  const walk = (dir: string, top: boolean) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(dir, name);
      if (skip.has(abs) || abs === codexHome) continue;
      if (top && (SKIP_TOP.has(name) || name === dbName || name.startsWith(`${dbName}.before-`) || name === CODEX_IN_ARCHIVE)) continue;
      if (SQLITE_SIDE.test(name)) continue;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue; // Deleted while the folder was read.
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs, false);
      else if (st.isFile()) out.push({ abs, rel: relative(dataDir, abs).split(sep).join('/'), size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(dataDir, true);

  if (codexHome) {
    for (const name of CODEX_FILES) {
      const abs = join(codexHome, name);
      try {
        const st = lstatSync(abs);
        if (st.isFile()) out.push({ abs, rel: `${CODEX_IN_ARCHIVE}/${name}`, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // Not signed in yet: no sign-in file.
      }
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** The SHA-256 of a file, in lowercase hex, read in pieces. */
export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest('hex');
}

function tar(args: string[], what: string) {
  const r = Bun.spawnSync(['tar', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`tar could not ${what}: ${r.stderr.toString().trim().slice(-300)}`);
  return r.stdout.toString();
}

/**
 * Builds the archive at `out` from a consistent database copy and the files to keep. The files are copied into a
 * staging folder first, so a file that changes while tar reads it cannot break the archive.
 */
export async function buildArchive(opts: { dbCopy: string; files: Entry[]; out: string; work: string }): Promise<{ size: number; sha256: string; files: number }> {
  mkdirSync(opts.work, { recursive: true });
  const stage = mkdtempSync(join(opts.work, 'stage-'));
  try {
    copyFileSync(opts.dbCopy, join(stage, DB_IN_ARCHIVE));
    let n = 1;
    for (const f of opts.files) {
      const to = join(stage, ...f.rel.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      try {
        copyFileSync(f.abs, to);
        n++;
      } catch {
        // Deleted since it was listed: the next backup has the folder as it is then.
      }
    }
    rmSync(opts.out, { force: true });
    mkdirSync(dirname(opts.out), { recursive: true });
    tar(['-czf', opts.out, '-C', stage, '.'], 'write the archive');
    return { size: statSync(opts.out).size, sha256: await sha256File(opts.out), files: n };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** The member paths of an archive, refused when any is absolute, climbs out with "..", or is not a plain path. */
export function listArchive(file: string): string[] {
  const names = tar(['-tzf', file], 'read the archive').split('\n').filter((l) => l !== '');
  for (const name of names) {
    const clean = name.replace(/^\.\//, '');
    if (name.startsWith('/') || clean.split('/').includes('..') || name.includes('\\') || name.includes('\0')) {
      throw new Error(`the archive has an unsafe path: ${JSON.stringify(name.slice(0, 120))}`);
    }
  }
  return names;
}

/**
 * Unpacks an archive into a new folder `into` (which must not exist), after checking its paths. Anything that is
 * not a plain file or folder after unpacking (a symbolic link, say) is refused.
 */
export function unpackArchive(file: string, into: string): void {
  listArchive(file);
  if (existsSync(into)) throw new Error(`${into} already exists`);
  mkdirSync(into, { recursive: true });
  tar(['-xzf', file, '-C', into], 'unpack the archive');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (!st.isFile()) throw new Error(`the archive holds something that is not a file: ${relative(into, abs)}`);
    }
  };
  walk(into);
}

/** Moves a file or folder; across file systems (EXDEV), copies it and removes the original. */
function move(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Moves an unpacked backup into place: the database to `layout.db`, codex/ into the Codex home, everything else
 * into the data folder. The data folder must hold no database yet.
 */
export function placeUnpacked(unpacked: string, layout: Layout): void {
  const dataDir = dirname(resolve(layout.db));
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(layout.db)) throw new Error(`there is already a database at ${layout.db}; nothing was replaced`);
  for (const name of readdirSync(unpacked)) {
    const from = join(unpacked, name);
    if (name === DB_IN_ARCHIVE) continue;
    if (name === CODEX_IN_ARCHIVE) {
      if (!layout.codexHome) continue;
      mkdirSync(layout.codexHome, { recursive: true });
      for (const f of readdirSync(from)) if (CODEX_FILES.includes(f)) move(join(from, f), join(layout.codexHome, f));
      continue;
    }
    const to = join(dataDir, name);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    move(from, to);
  }
  // The database goes in last: its presence is what says a restore finished.
  move(join(unpacked, DB_IN_ARCHIVE), layout.db);
}
