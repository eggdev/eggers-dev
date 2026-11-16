// The keeper's start-up self-test: are the programs the app runs there, is Codex signed in, and can Codex's
// read-only sandbox start? It spends no model quota: `codex login status` reads the sign-in file, and
// `codex sandbox` runs one local command in the sandbox without asking a model anything.
// No output that could hold a secret is kept: the sign-in check keeps only which kind of sign-in it found.
// A failed check does not stop the app. The status endpoint reports it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Check = { ok: boolean; detail: string };
export type SelfTest = {
  at: number;
  programs: Record<string, Check>;
  codexSignedIn: Check;
  /** ok: the sandbox ran a command; failed: it did not; unknown: it could not be tried. */
  codexSandbox: { state: 'ok' | 'failed' | 'unknown'; detail: string };
};

type Run = (cmd: string[], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined> }) => Promise<{ code: number | null; out: string; err: string }>;

/** Runs a program with a time limit. A program that is not there answers code null. */
export const run: Run = async (cmd, opts = {}) => {
  try {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env as Record<string, string> | undefined, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs ?? 20_000);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return { code: proc.signalCode ? null : code, out, err };
  } catch (error) {
    return { code: null, out: '', err: (error as Error).message };
  }
};

const firstLine = (s: string) => s.trim().split('\n')[0]?.trim().slice(0, 120) ?? '';

// The whole message of a failed check, on one line. It holds no secret: the checks here read no sign-in file.
const whole = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 900);

/** Why the sandbox may not start: what the kernel allows, and whether bubblewrap alone can make its namespaces. */
async function sandboxClues(runner: Run, cwd: string): Promise<string> {
  const tries: [string, string[]][] = [
    ['kernel', ['uname', '-r']],
    ['user', ['id']],
    ['max_user_namespaces', ['cat', '/proc/sys/user/max_user_namespaces']],
    ['unprivileged_userns_clone', ['cat', '/proc/sys/kernel/unprivileged_userns_clone']],
    ['seccomp', ['grep', '-E', '^(Seccomp|NoNewPrivs|CapEff)', '/proc/self/status']],
    ['caps', ['grep', '-E', '^Cap(Prm|Eff|Bnd|Amb)', '/proc/self/status']],
    ['bwrap all namespaces', ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-all', '/bin/sh', '-c', 'echo ok']],
    ['bwrap user and mount only', ['bwrap', '--ro-bind', '/', '/', '--unshare-user', '/bin/sh', '-c', 'echo ok']],
    ['bwrap no namespaces', ['bwrap', '--ro-bind', '/', '/', '/bin/sh', '-c', 'echo ok']],
  ];
  const out: string[] = [];
  for (const [name, cmd] of tries) {
    const r = await runner(cmd, { cwd, timeoutMs: 10_000 });
    out.push(`${name}: ${r.code === 0 ? whole(r.out).slice(0, 160) : `failed (${r.code}) ${whole(r.err || r.out).slice(0, 200)}`}`);
  }
  return ` | clues: ${out.join(' | ')}`;
}

async function version(cmd: string[], runner: Run): Promise<Check> {
  const r = await runner(cmd);
  if (r.code === 0) return { ok: true, detail: firstLine(r.out || r.err) };
  return { ok: false, detail: r.code === null ? 'not found or did not answer' : `exit ${r.code}: ${firstLine(r.err || r.out)}` };
}

/** Which kind of sign-in `codex login status` reports. Its exact words are never kept: one form shows part of a key. */
export function signInKind(code: number | null, text: string): Check {
  const line = firstLine(text);
  if (code === 0 && line.startsWith('Logged in using ChatGPT')) return { ok: true, detail: 'signed in with ChatGPT' };
  if (code === 0 && line.startsWith('Logged in using')) return { ok: true, detail: 'signed in (not with ChatGPT)' };
  if (code === 0 && line.startsWith('API key configured')) return { ok: true, detail: 'signed in with an API key' };
  if (line.startsWith('Not logged in')) return { ok: false, detail: 'not signed in' };
  return { ok: false, detail: code === null ? 'codex did not answer' : `codex login status exited ${code}` };
}

/**
 * The sign-in check alone: `codex login status`, run as the app runs Codex. The keeper runs it again after a
 * sign-in made in the container (codexlogin.ts).
 */
export async function codexSignIn(env: { CODEX_BIN?: string; codexEnv: Record<string, string | undefined>; prefix?: string[] }, plainRunner: Run = run): Promise<Check> {
  const status = await plainRunner([...(env.prefix ?? []), env.CODEX_BIN || 'codex', 'login', 'status'], { env: env.codexEnv, timeoutMs: 20_000 });
  return signInKind(status.code, status.err || status.out);
}

/** `prefix` is what the keeper puts before the app's commands (it drops capabilities), so the checks run as the app does. */
export async function selfTest(env: { CHROME?: string; CODEX_BIN?: string; codexEnv: Record<string, string | undefined>; prefix?: string[] }, plainRunner: Run = run): Promise<SelfTest> {
  const codex = env.CODEX_BIN || 'codex';
  const prefix = env.prefix ?? [];
  const runner: Run = (cmd, opts) => plainRunner([...prefix, ...cmd], opts);
  const programs: Record<string, Check> = {
    bun: { ok: true, detail: Bun.version },
    codex: await version([codex, '--version'], runner),
    chromium: await version([env.CHROME || 'chromium', '--version'], runner),
    git: await version(['git', '--version'], runner),
    gh: await version(['gh', '--version'], runner),
    pandoc: await version(['pandoc', '--version'], runner),
    pdftotext: await version(['pdftotext', '-v'], runner),
    unzip: await version(['unzip', '-v'], runner),
    bwrap: await version(['bwrap', '--version'], runner),
  };

  let codexSignedIn: Check = { ok: false, detail: 'codex is not installed' };
  let codexSandbox: SelfTest['codexSandbox'] = { state: 'unknown', detail: 'codex is not installed' };
  if (programs.codex!.ok) {
    codexSignedIn = await codexSignIn(env, plainRunner);

    // One harmless command in the read-only sandbox, from an empty folder.
    const dir = mkdtempSync(join(tmpdir(), 'keeper-sandbox-'));
    try {
      const probe = await runner([codex, '-c', 'sandbox_mode="read-only"', 'sandbox', '--', '/bin/sh', '-c', 'echo sandbox-ok'], { cwd: dir, env: env.codexEnv, timeoutMs: 30_000 });
      if (probe.code === 0 && probe.out.includes('sandbox-ok')) codexSandbox = { state: 'ok', detail: 'the read-only sandbox ran a command' };
      else if (probe.code === null) codexSandbox = { state: 'unknown', detail: 'codex sandbox did not answer in 30 s' };
      else codexSandbox = { state: 'failed', detail: `exit ${probe.code}: ${whole(probe.err || probe.out)}${await sandboxClues(runner, dir)}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { at: Date.now(), programs, codexSignedIn, codexSandbox };
}
