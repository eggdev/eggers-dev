// The one place a model is asked anything. Two backends, chosen by EGG_LLM:
// - unset or "claude": headless Claude Code (`claude -p`) on this machine, under whatever login it
//   already has. No API key. Each call starts clean: no user settings, hooks, plugins or MCP servers,
//   and only the tools named. A model named "gpt" or "gpt:<name>" still goes to Codex (a second opinion).
// - "codex": every call goes to OpenAI's Codex command (`codex exec`) under its own sign-in
//   (`codex login`), whatever model the call names. See codexCommand for how names and tools map.
// This file must not import the database: the unit tests import it.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type Ask = {
  prompt: string;
  schema: object; // JSON Schema of the answer
  cwd: string; // the only directory its file tools may read
  tools?: string[]; // built-in tools it may use, e.g. ['Read'] or ['Read', 'Grep', 'Glob', 'Bash']
  allow?: string[]; // permission rules, e.g. ['Read', 'Bash(git log:*)']
  timeoutMs?: number;
  model?: string;
  // How hard the model thinks before it answers: 'low' for quick sorting and first readings, unset for the model's own default.
  effort?: 'low' | 'medium' | 'high';
};

type Env = Record<string, string | undefined>;
export type Backend = 'claude' | 'codex';

// Which backend EGG_LLM names. Any other value is a mistake, so it stops the call instead of guessing.
export function llmBackend(env: Env = process.env): Backend {
  const v = (env.EGG_LLM ?? '').trim().toLowerCase();
  if (v === '' || v === 'claude') return 'claude';
  if (v === 'codex') return 'codex';
  throw new Error(`EGG_LLM is "${env.EGG_LLM}". Set it to "claude" or "codex", or leave it unset.`);
}

// True when this call goes to Codex: always under EGG_LLM=codex, else only for a "gpt" model.
export const usesCodex = (model: string, env: Env = process.env) => llmBackend(env) === 'codex' || model === 'gpt' || model.startsWith('gpt:');

// A stand-in for the model, for tests: while one is set, every call is answered by it and no command is
// started. Nothing outside a test sets it. With none set, a call made under `bun test` is refused, so a
// test can never reach a real model by mistake.
let standIn: ((call: Ask) => unknown) | undefined;
export function fakeAsk(answer?: (call: Ask) => unknown): void { standIn = answer; }

export async function ask<T>(call: Ask): Promise<T> {
  if (standIn) return (await standIn(call)) as T;
  if (process.env.NODE_ENV === 'test') throw new Error('A test asked a model with no stand-in set (fakeAsk in lib/llm.ts).');
  const { prompt, schema, cwd, tools = [], allow = [], timeoutMs = 300_000, model = process.env.EGG_MODEL ?? 'sonnet', effort } = call;
  if (usesCodex(model)) return askCodex<T>({ prompt, schema, cwd, tools, timeoutMs, model, effort });
  const args = ['claude', '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--model', model, ...(effort ? ['--effort', effort] : []),
    '--tools', tools.join(','), ...(allow.length ? ['--allowedTools', ...allow] : [])];
  const proc = Bun.spawn(args, { cwd, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (proc.signalCode) throw new Error(`Reading took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`);
  let reply: { is_error?: boolean; result?: string; structured_output?: unknown };
  try { reply = JSON.parse(out); } catch { throw new Error(`Claude Code exited with code ${code}: ${(err || out).trim().slice(0, 300)}`); }
  // EGG_TIMING=1 prints how long the model took and how much it wrote, to see where a slow step spends its time.
  if (process.env.EGG_TIMING) console.log(`  ${model}: ${Math.round(((reply as { duration_api_ms?: number }).duration_api_ms ?? 0) / 1000)} s, ${(reply as { num_turns?: number }).num_turns} turns, ${(reply as { usage?: { output_tokens?: number; input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage?.output_tokens} tokens out, ${((reply as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage?.input_tokens ?? 0) + ((reply as { usage?: { cache_creation_input_tokens?: number } }).usage?.cache_creation_input_tokens ?? 0) + ((reply as { usage?: { cache_read_input_tokens?: number } }).usage?.cache_read_input_tokens ?? 0)} in`);
  if (reply.is_error) throw new Error(`Claude Code reported an error: ${String(reply.result ?? '').slice(0, 300)}`);
  if (reply.structured_output !== undefined) return reply.structured_output as T;
  try { return JSON.parse(reply.result ?? '') as T; } catch { throw new Error('Claude Code answered without the structured result.'); }
}

// ---- Codex ----------------------------------------------------------------------------------
// Codex has no list of allowed tools. Its control is the sandbox, and every call here runs in the
// read-only one: commands may read files but not write them, and have no network. Never
// workspace-write, never danger-full-access, never a --dangerously-* flag, and no fallback to them.

// The model each Claude name stands for under Codex. EGG_CODEX_OPUS, EGG_CODEX_SONNET and
// EGG_CODEX_HAIKU change them. "gpt" is Codex's own default model; "gpt:<name>" is <name>.
// Any other name is passed through as given. undefined means: pass no model, use Codex's default.
export const CODEX_MODELS = { opus: 'gpt-6.1-sol', sonnet: 'gpt-6.1-terra', haiku: 'gpt-6-luna' } as const;
export function codexModel(model: string, env: Env = process.env): string | undefined {
  if (model === 'opus') return env.EGG_CODEX_OPUS || CODEX_MODELS.opus;
  if (model === 'sonnet') return env.EGG_CODEX_SONNET || CODEX_MODELS.sonnet;
  if (model === 'haiku') return env.EGG_CODEX_HAIKU || CODEX_MODELS.haiku;
  if (model === 'gpt') return undefined;
  if (model.startsWith('gpt:')) return model.slice(4) || undefined;
  return model || undefined;
}

// The `codex exec` command for one call, and the folder it runs in. Pure, so it is tested.
// - No tools: the run starts in an empty folder, and the shell tool is switched off, so the model
//   sees the prompt and nothing else.
// - Tools (Read, Grep, Glob, Bash): the run starts in the call's folder, with the shell on, still
//   under the read-only sandbox. That covers reading a file and running `git log` and the like.
// Codex's own settings that could steer a run are left out: the user's config.toml, .rules files,
// AGENTS.md files in the project (project_doc_max_bytes=0), skills, apps, plugins and web search.
// An AGENTS.md in CODEX_HOME itself is still read: keep that folder free of one.
export function codexCommand(o: { bin: string; model: string; effort?: string; tools: string[]; cwd: string; empty: string; schemaFile: string; outFile: string; json?: boolean },
  env: Env = process.env): { args: string[]; cwd: string } {
  const m = codexModel(o.model, env);
  const tools = o.tools.length > 0;
  const cwd = tools ? resolve(o.cwd) : o.empty;
  const args = [o.bin, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--color', 'never',
    '-c', 'approval_policy="never"', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
    '-c', 'skills.include_instructions=false', '-c', 'skills.bundled.enabled=false', '--disable', 'apps', '--disable', 'plugins',
    ...(tools ? [] : ['--disable', 'shell_tool', '--disable', 'unified_exec']),
    ...(m ? ['-m', m] : []), ...(o.effort ? ['-c', `model_reasoning_effort="${o.effort}"`] : []),
    '-C', cwd, '--output-schema', o.schemaFile, '-o', o.outFile, ...(o.json ? ['--json'] : []), '-'];
  return { args, cwd };
}

// OpenAI's structured output insists that every object lists all its properties in "required" and
// sets "additionalProperties": false. The schemas in this app already do. For one that does not, a
// property it left optional becomes required but may be null. Returns a new schema; the input is kept.
export function strictSchema<S>(schema: S): S {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const n = Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) =>
      [k, k === 'properties' || k === '$defs' || k === 'definitions'
        ? Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([p, s]) => [p, walk(s)])) : walk(v)])) as Record<string, unknown>;
    const isObject = n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object')) || (n.type === undefined && n.properties !== undefined);
    if (!isObject) return n;
    const props = (n.properties ?? {}) as Record<string, unknown>;
    const had = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
    n.properties = Object.fromEntries(Object.entries(props).map(([p, s]) => [p, had.has(p) ? s : { anyOf: [s, { type: 'null' }] }]));
    n.required = Object.keys(props);
    n.additionalProperties = false;
    return n;
  };
  return walk(schema) as S;
}

// The codex command: CODEX_BIN when set, then the one on PATH, then ~/.local/bin/codex.
export function codexBin(env: Env = process.env): string | null {
  return [env.CODEX_BIN, Bun.which('codex'), join(homedir(), '.local/bin/codex')]
    .find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p)) ?? null;
}
export const gptAvailable = () => codexBin() !== null;

// Runs a short command with a time limit. Its output stays here: callers report only a summary.
async function run(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string; killed: boolean }> {
  const proc = Bun.spawn(args, { cwd: tmpdir(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { code, out, err, killed: proc.signalCode !== null };
}

// Whether the read-only sandbox can start here: it runs `sh -c 'exit 0'` inside it, and asks no
// model. Inside some containers it cannot start (on Linux it needs bubblewrap and user namespaces).
// A success is remembered for the life of the process.
let sandboxWorks = false;
async function sandboxProblem(bin: string): Promise<string | null> {
  if (sandboxWorks) return null;
  try {
    const r = await run([bin, 'sandbox', '--', Bun.which('sh') ?? '/bin/sh', '-c', 'exit 0'], 30_000);
    if (r.code === 0 && !r.killed) { sandboxWorks = true; return null; }
    return r.killed ? 'The check timed out.' : `The check exited with code ${r.code}: ${(r.err || r.out).trim().slice(-300)}`;
  } catch (e) { return (e as Error).message; }
}
const sandboxError = (detail: string) => new Error(`The Codex sandbox could not start on this machine, so nothing was run. Codex reads files only inside its read-only sandbox; on Linux that needs bubblewrap (bwrap) and unprivileged user namespaces. ${detail}`);

// What a run with --json reports: the tokens used, and how many commands the model ran.
export function codexUsage(jsonl: string): { tokensIn?: number; tokensOut?: number; commands: number } {
  let tokensIn: number | undefined, tokensOut: number | undefined, commands = 0;
  for (const line of jsonl.split('\n')) {
    let e: { type?: string; usage?: { input_tokens?: number; output_tokens?: number }; item?: { type?: string } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.usage) { tokensIn = (tokensIn ?? 0) + (e.usage.input_tokens ?? 0); tokensOut = (tokensOut ?? 0) + (e.usage.output_tokens ?? 0); }
    if (e.type === 'item.completed' && e.item?.type === 'command_execution') commands++;
  }
  return { tokensIn, tokensOut, commands };
}

// The answer Codex wrote: the JSON object, also when it came wrapped in a code fence.
export function parseCodexAnswer<T>(text: string): T {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')) as T;
}

async function askCodex<T>({ prompt, schema, cwd, tools, timeoutMs, model, effort }: { prompt: string; schema: object; cwd: string; tools: string[]; timeoutMs: number; model: string; effort?: string }): Promise<T> {
  const bin = codexBin();
  if (!bin) throw new Error('Codex is not installed on this machine. Install it, or set CODEX_BIN to its path.');
  // Only a call with tools runs commands, so only it needs the sandbox.
  if (tools.length > 0) { const problem = await sandboxProblem(bin); if (problem) throw sandboxError(problem); }
  const dir = mkdtempSync(join(tmpdir(), 'egg-codex-'));
  try {
    const empty = join(dir, 'work');
    mkdirSync(empty);
    const schemaFile = join(dir, 'schema.json'), outFile = join(dir, 'out.json');
    writeFileSync(schemaFile, JSON.stringify(strictSchema(schema)));
    const timing = !!process.env.EGG_TIMING;
    const cmd = codexCommand({ bin, model, effort, tools, cwd, empty, schemaFile, outFile, json: timing });
    const started = Date.now();
    const proc = Bun.spawn(cmd.args, { cwd: cmd.cwd, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (proc.signalCode) throw new Error(`Codex took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`);
    // EGG_TIMING=1: wall time (Codex reports no model time), commands run, and tokens.
    if (timing) {
      const u = codexUsage(out);
      console.log(`  ${codexModel(model) ?? 'codex default'} (${model}): ${Math.round((Date.now() - started) / 1000)} s, ${u.commands} commands, ${u.tokensOut ?? '?'} tokens out, ${u.tokensIn ?? '?'} in`);
    }
    if (code !== 0 || !existsSync(outFile)) {
      const tail = (err || out).trim().slice(-300);
      if (/bwrap|bubblewrap|user namespace|landlock|seccomp|sandbox (?:could not|cannot|failed|is unavailable)/i.test(err)) throw sandboxError(tail);
      throw new Error(`Codex exited with code ${code}: ${tail}`);
    }
    try { return parseCodexAnswer<T>(readFileSync(outFile, 'utf8')); } catch { throw new Error('Codex answered without the structured result.'); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Whether the configured backend can run, without asking a model anything. For the health check.
// It says only whether there is a sign-in, never what it is.
export async function llmReady(): Promise<{ ok: boolean; detail: string }> {
  let backend: Backend;
  try { backend = llmBackend(); } catch (e) { return { ok: false, detail: (e as Error).message }; }
  if (backend === 'claude') {
    return Bun.which('claude') ? { ok: true, detail: 'Claude Code is installed. Its sign-in is not checked.' } : { ok: false, detail: 'The claude command is not installed on this machine.' };
  }
  const bin = codexBin();
  if (!bin) return { ok: false, detail: 'The codex command is not installed. Install it, or set CODEX_BIN to its path.' };
  let r: Awaited<ReturnType<typeof run>>;
  try { r = await run([bin, 'login', 'status'], 30_000); } catch (e) { return { ok: false, detail: `codex login status could not run: ${(e as Error).message}` }; }
  if (r.killed) return { ok: false, detail: 'codex login status did not answer within 30 seconds.' };
  const said = `${r.out}\n${r.err}`;
  if (r.code !== 0 || !/logged in/i.test(said) || /not logged in/i.test(said)) return { ok: false, detail: 'Codex is not signed in. Run `codex login` with CODEX_HOME set as the server has it.' };
  const how = /chatgpt/i.test(said) ? 'with ChatGPT' : /api key/i.test(said) ? 'with an API key' : 'with an unknown method';
  const problem = await sandboxProblem(bin);
  if (problem) return { ok: false, detail: `Codex is signed in ${how}, but its read-only sandbox could not start, so files cannot be read. ${problem.slice(0, 200)}` };
  return { ok: true, detail: `Codex is signed in ${how}, and its read-only sandbox starts.` };
}
