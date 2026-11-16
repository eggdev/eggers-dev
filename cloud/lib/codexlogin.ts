// The Codex sign-in, made from inside the container, so the owner needs no machine of their own to renew it.
// It uses Codex's device sign-in: `codex login --device-auth` prints a web address and a one-time code; the owner
// opens the address on any device, signs in and types the code; Codex then writes auth.json into CODEX_HOME and
// exits 0. cloud/keeper.ts wires this to the real process; the tests wire it to a fake one.
//
//   start()    starts the command and answers as soon as the address and code are known, or with an error when
//              they do not appear in about 20 seconds. Only one sign-in runs at a time: a second start while one
//              waits answers with the same address and code.
//   cancel()   stops a sign-in that waits.
//   status()   {state: idle | waiting | done | failed, url?, code?, startedAt?, endedAt?, detail?}
//
// The address is taken only when its host is auth.openai.com, where Codex's device sign-in lives. Any other
// address in the output (an update notice, say) is passed over: the owner is never sent anywhere else.
//
// The command gets at most 15 minutes (Codex's own code expires after 15). When it exits 0, in order: the sign-in
// check runs again (`codex login status`) and the keeper's status takes its answer; the app's readiness view is
// read again; and a backup is made at once, so the new sign-in survives a restart of the container. Exit 0 means
// the sign-in is written, so it is checked and reported as done even when the time limit or a cancel came at the
// same moment. While the check runs, the status is "waiting" without the address and code (they are used), and a
// start answers with that status and starts nothing.
//
// What is kept of the program's output: the address and the code, while the sign-in waits, and nothing else. The
// output is never logged. The `detail` of a failure is a fixed phrase or an exit code, never the program's words:
// they could hold part of a secret.
import type { Proc } from './children.ts';
import type { Check } from './selftest.ts';

export type CodexLoginStatus = {
  state: 'idle' | 'waiting' | 'done' | 'failed';
  /** The address to open and the code to type there. Only while the sign-in waits. */
  url?: string;
  code?: string;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
};

/** What start() and cancel() answer. `error` is a plain sentence for the owner. */
export type LoginAnswer = { ok: true; codexLogin: CodexLoginStatus } | { ok: false; error: string; codexLogin: CodexLoginStatus };

export type LoginSpec = { cmd: string[]; cwd: string; env: Record<string, string> };
/** Starts the command. `onText` gets every piece of its standard output and standard error. */
export type SpawnLogin = (spec: LoginSpec, onText: (text: string) => void) => Proc;

/** Starts the real command. Its output goes to `onText` only: never to the log. */
export const spawnLogin: SpawnLogin = (spec, onText) => {
  const child = Bun.spawn(spec.cmd, { cwd: spec.cwd, env: spec.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }));
  };
  void read(child.stdout).catch(() => {});
  void read(child.stderr).catch(() => {});
  return child;
};

// Terminal colour and cursor codes (CSI), and window-title codes (OSC). Codex colours its output even in a pipe.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// The one-time code stands alone on its line: two groups of capitals and digits (Codex 0.169.0: ABCD-12345).
const CODE_LINE = /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/;
const URLS_IN_LINE = /https:\/\/[^\s"'<>]+/g;
/** The only host a sign-in address may have. */
export const SIGN_IN_HOST = 'auth.openai.com';

/** Whether an address is an https address on the sign-in host itself (not a look-alike, not a "user@" trick). */
function signInAddress(found: string): boolean {
  try {
    const url = new URL(found);
    return url.protocol === 'https:' && url.host === SIGN_IN_HOST;
  } catch {
    return false;
  }
}

/**
 * The address and the one-time code in what `codex login --device-auth` has printed so far, or null while either
 * is missing. Only whole lines are read, so a code that has arrived in part is never taken for the code. An address
 * on any host but the sign-in host is not the address: it is passed over, and the wait goes on.
 */
export function parseDeviceAuth(output: string): { url: string; code: string } | null {
  const plain = output.replace(ANSI, '').replace(/\r\n?/g, '\n');
  const lines = plain.slice(0, plain.lastIndexOf('\n') + 1).split('\n').map((line) => line.trim());
  const url = lines.flatMap((line) => line.match(URLS_IN_LINE) ?? []).find(signInAddress);
  const code = lines.find((line) => CODE_LINE.test(line));
  return url && code ? { url, code } : null;
}

export type LoginDeps = {
  /** The command, as the app's own processes run: the same environment and the same capability-dropping prefix. */
  spec: LoginSpec;
  spawn: SpawnLogin;
  /** Runs the sign-in check (`codex login status`) and answers which kind of sign-in it found. */
  check: () => Promise<Check>;
  /** Takes the check's answer after a sign-in, for the keeper's status. */
  report: (check: Check) => void;
  /** Reads the app's readiness view again. */
  refresh: () => Promise<void>;
  /** Makes a backup now. */
  backup: () => Promise<{ ok: boolean; reason?: string }>;
  log: (line: string) => void;
  now?: () => number;
  /** Calls `fn` after `ms`; the returned function cancels it. A fake in tests. */
  timer?: (ms: number, fn: () => void) => () => void;
  /** How long the address and code may take to appear. */
  announceMs?: number;
  /** The longest the command may run. */
  limitMs?: number;
  /** How long the command has after SIGTERM before SIGKILL. */
  killGraceMs?: number;
};

export const ANNOUNCE_MS = 20_000;
export const LIMIT_MS = 15 * 60_000;
// Enough for the lines before the code, with room to spare. Nothing more of the output is held.
const MAX_OUTPUT = 16_384;

export const LOGIN_MESSAGES = {
  noCode: 'Codex did not give a sign-in address and code. Try again.',
  cancelled: 'The sign-in was cancelled.',
  notStarted: 'Codex could not be started in the container.',
} as const;

type Run = {
  proc: Proc | null;
  startedAt: number;
  /** Whether the address and code are known. */
  known: boolean;
  /** Whether the command has exited. From then on the address and code are used, and nothing is left to stop. */
  exited: boolean;
  /** Why the keeper stopped the command, when it did. */
  ending: 'cancelled' | 'silent' | 'limit' | null;
  announced: Promise<LoginAnswer>;
  announce: (answer: LoginAnswer) => void;
  /** Resolves when the command has exited and the status says how it ended. */
  ended: Promise<void>;
  cancelTimers: (() => void)[];
};

export class CodexLogin {
  private s: CodexLoginStatus = { state: 'idle' };
  private run: Run | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly timer: (ms: number, fn: () => void) => () => void;

  constructor(private readonly d: LoginDeps) {
    this.now = d.now ?? Date.now;
    this.timer = d.timer ?? ((ms, fn) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  }

  status(): CodexLoginStatus {
    return { ...this.s };
  }

  /** Whether a sign-in is in hand: the command runs, or its result is being checked. */
  get waiting(): boolean {
    return this.run !== null;
  }

  /** Resolves when no sign-in is in hand and the work after the last one (the backup) is done. */
  async settled(): Promise<void> {
    while (this.run) await this.run.ended;
    await this.tail;
  }

  /** Starts a sign-in, or joins the one that waits. Answers when the address and code are known, or with why not. */
  start(): Promise<LoginAnswer> {
    // The command of the sign-in in hand has exited and its result is being checked: the status as it is now,
    // never the address and code that were just used. Nothing new starts until the check is done.
    if (this.run?.exited) return Promise.resolve({ ok: true, codexLogin: this.status() });
    if (this.run) return this.run.announced;

    const startedAt = this.now();
    let announce: (answer: LoginAnswer) => void = () => {};
    const announced = new Promise<LoginAnswer>((resolve) => { announce = resolve; });
    const run: Run = { proc: null, startedAt, known: false, exited: false, ending: null, announced, announce, ended: Promise.resolve(), cancelTimers: [] };
    this.run = run;
    this.s = { state: 'waiting', startedAt };

    let output = '';
    const onText = (text: string) => {
      if (run.known || this.run !== run || run.ending) return;
      output = (output + text).slice(-MAX_OUTPUT);
      const found = parseDeviceAuth(output);
      if (!found) return;
      run.known = true;
      output = '';
      this.s = { state: 'waiting', url: found.url, code: found.code, startedAt };
      announce({ ok: true, codexLogin: this.status() });
    };

    try {
      run.proc = this.d.spawn(this.d.spec, onText);
    } catch {
      this.run = null;
      this.s = { state: 'failed', startedAt, endedAt: this.now(), detail: 'codex could not be started' };
      this.d.log('codex sign-in: failed (codex could not be started)');
      return Promise.resolve({ ok: false, error: LOGIN_MESSAGES.notStarted, codexLogin: this.status() });
    }
    this.d.log('codex sign-in: started; waiting for the owner');
    run.cancelTimers.push(
      this.timer(this.d.announceMs ?? ANNOUNCE_MS, () => { if (!run.known) this.end(run, 'silent'); }),
      this.timer(this.d.limitMs ?? LIMIT_MS, () => this.end(run, 'limit')),
    );
    const proc = run.proc;
    let ended: () => void = () => {};
    run.ended = new Promise<void>((resolve) => { ended = resolve; });
    this.tail = proc.exited.then((code) => code, () => -1).then((code) => this.exited(run, code, ended)).catch((error) => {
      // Never expected. The sign-in is not left "waiting" for ever.
      if (this.run === run) this.run = null;
      this.s = { state: 'failed', startedAt, endedAt: this.now(), detail: 'the keeper could not finish the sign-in' };
      this.d.log(`codex sign-in: failed in the keeper (${(error as Error).message})`);
      ended();
    });
    return announced;
  }

  /** Stops a sign-in that waits. With none in hand it changes nothing. */
  async cancel(): Promise<LoginAnswer> {
    const run = this.run;
    if (run) {
      this.end(run, 'cancelled');
      await run.ended;
    }
    return { ok: true, codexLogin: this.status() };
  }

  /** Stops the command for a reason: SIGTERM, then SIGKILL when it does not exit. */
  private end(run: Run, why: NonNullable<Run['ending']>) {
    if (run.ending || !run.proc) return;
    run.ending = why;
    const proc = run.proc;
    try { proc.kill('SIGTERM'); } catch { /* Already gone. */ }
    run.cancelTimers.push(this.timer(this.d.killGraceMs ?? 5_000, () => {
      try { proc.kill('SIGKILL'); } catch { /* Already gone. */ }
    }));
  }

  /** The command has exited: say how it ended, and after a sign-in check it, report it and back it up. */
  private async exited(run: Run, code: number, ended: () => void): Promise<void> {
    for (const cancel of run.cancelTimers) cancel();
    // Nothing is left to stop: a cancel or a time limit from here on changes nothing.
    run.proc = null;
    run.exited = true;
    const { startedAt } = run;
    const finish = (s: CodexLoginStatus, answer: LoginAnswer | null) => {
      this.s = s;
      if (this.run === run) this.run = null;
      // A start that still waits for the address and code gets its answer now.
      if (!run.known) run.announce(answer ?? { ok: true, codexLogin: this.status() });
      ended();
    };
    const failed = (detail: string, error: string) => {
      this.d.log(`codex sign-in: failed (${detail})`);
      const s: CodexLoginStatus = { state: 'failed', startedAt, endedAt: this.now(), detail };
      finish(s, { ok: false, error, codexLogin: s });
    };

    // Why the keeper stopped the command counts only when the command did not finish the sign-in by itself. A
    // sign-in that completes just as the time limit fires (or a cancel arrives) exits 0, and is a sign-in.
    if (code !== 0) {
      if (run.ending === 'cancelled') {
        this.d.log('codex sign-in: cancelled');
        const s: CodexLoginStatus = { state: 'idle', endedAt: this.now(), detail: 'cancelled' };
        return finish(s, { ok: false, error: LOGIN_MESSAGES.cancelled, codexLogin: s });
      }
      if (run.ending === 'silent') return failed(`codex printed no address and code in ${Math.round((this.d.announceMs ?? ANNOUNCE_MS) / 1000)} s`, LOGIN_MESSAGES.noCode);
      if (run.ending === 'limit') return failed(`the sign-in was not completed in ${Math.round((this.d.limitMs ?? LIMIT_MS) / 60_000)} minutes`, LOGIN_MESSAGES.noCode);
      return failed(`codex login exited ${code}`, LOGIN_MESSAGES.noCode);
    }

    // Exit 0: Codex says the sign-in is written. The address and code are used: the status drops them while the
    // check says what is there now.
    this.s = { state: 'waiting', startedAt };
    let check: Check;
    try {
      check = await this.d.check();
    } catch {
      check = { ok: false, detail: 'the sign-in check could not run' };
    }
    this.d.report(check);
    if (check.ok) {
      this.d.log(`codex sign-in: done (${check.detail})`);
      finish({ state: 'done', startedAt, endedAt: this.now(), detail: check.detail }, null);
    } else {
      failed(`codex login exited 0, but the check says: ${check.detail}`, LOGIN_MESSAGES.noCode);
    }

    await this.d.refresh().catch((error) => this.d.log(`codex sign-in: the readiness view could not be read again (${(error as Error).message})`));
    if (!check.ok) return;
    // Now, not after the quiet period: a container that restarts before the backup would start with the old sign-in.
    const saved = await this.d.backup().catch((error) => ({ ok: false, reason: (error as Error).message }));
    if (!saved.ok) this.d.log(`codex sign-in: the backup of the new sign-in did not happen (${saved.reason ?? 'unknown reason'}); the keeper tries again when it next backs up`);
  }
}
