// The app's two processes in the container, server.ts and worker.ts, run and restarted as tools/live.ts does on
// the owner's machine: a process that exits is started again after a wait that grows while it keeps failing.
// The keeper is the only thing that starts them, so exactly one worker runs.

// The wait before a restart: 1 s, doubled after each quick failure, at most 30 s. A process that ran a minute or
// more starts again after 1 s.
const FIRST_WAIT_MS = 1_000;
const MAX_WAIT_MS = 30_000;
const STEADY_MS = 60_000;

export type ChildSpec = { name: string; cmd: string[]; cwd: string; env: Record<string, string> };

/** What the supervisor needs from a running process: Bun's Subprocess has it, and tests pass a fake. */
export interface Proc {
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
}
export type Spawn = (spec: ChildSpec) => Proc;

/** Starts a process with its output lines prefixed by its name. */
export const spawnChild: Spawn = (spec) => {
  const child = Bun.spawn(spec.cmd, { cwd: spec.cwd, env: spec.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const pipe = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let rest = '';
    for await (const chunk of stream) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
      rest = lines.pop()!;
      for (const line of lines) console.log(`${spec.name} | ${line}`);
    }
    if (rest) console.log(`${spec.name} | ${rest}`);
  };
  void pipe(child.stdout).catch(() => {});
  void pipe(child.stderr).catch(() => {});
  return child;
};

export type ChildState = { running: boolean; starts: number; lastExit: number | null };

export class Supervisor {
  private stopping = false;
  private current: Proc | null = null;
  private wake: () => void = () => {};
  private loop: Promise<void> | null = null;
  readonly state: ChildState = { running: false, starts: 0, lastExit: null };

  constructor(
    private readonly spec: ChildSpec,
    private readonly spawn: Spawn,
    private readonly log: (line: string) => void,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  ) {}

  start() {
    this.loop ??= this.run();
  }

  private async run() {
    let wait = FIRST_WAIT_MS;
    while (!this.stopping) {
      const started = this.now();
      const proc = this.spawn(this.spec);
      this.current = proc;
      this.state.running = true;
      this.state.starts++;
      const code = await proc.exited;
      this.current = null;
      this.state.running = false;
      this.state.lastExit = code;
      if (this.stopping) break;
      if (this.now() - started >= STEADY_MS) wait = FIRST_WAIT_MS;
      this.log(`${this.spec.name} exited (code ${code}); starting it again in ${wait / 1000} s`);
      await Promise.race([this.sleep(wait), new Promise<void>((resolve) => { this.wake = resolve; })]);
      wait = Math.min(wait * 2, MAX_WAIT_MS);
    }
  }

  /** Stops the process: SIGTERM, then SIGKILL after the grace period. Resolves when it has exited. */
  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    this.wake();
    const proc = this.current;
    if (proc) {
      proc.kill('SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const killed = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.log(`${this.spec.name} did not stop in ${graceMs / 1000} s; killing it`);
          proc.kill('SIGKILL');
          resolve();
        }, graceMs);
      });
      await Promise.race([proc.exited, killed]);
      clearTimeout(timer);
      await proc.exited;
    }
    await this.loop;
  }
}
