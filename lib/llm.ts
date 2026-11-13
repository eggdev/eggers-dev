// The one place a model is asked anything: headless Claude Code (`claude -p`) on this machine,
// under whatever login it already has. No API key. To use another model or provider, replace `ask`.
// Each call starts clean: no user settings, hooks, plugins or MCP servers, and only the tools named.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

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

export async function ask<T>({ prompt, schema, cwd, tools = [], allow = [], timeoutMs = 300_000, model = process.env.EGG_MODEL ?? 'sonnet', effort }: Ask): Promise<T> {
  if (model === 'gpt' || model.startsWith('gpt:')) return askCodex<T>(prompt, schema, timeoutMs, model.slice(4));
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

// A model from another provider, for a second opinion: OpenAI's, through the Codex command under
// its own sign-in (`codex login`). Asked as model "gpt" (Codex's configured model) or "gpt:<name>".
// It runs in an empty folder with a read-only sandbox, so it sees the prompt and nothing else.
// The schema must list every property as required: OpenAI's structured output insists on it.
const codexBin = () => Bun.which('codex') ?? (existsSync(join(homedir(), '.local/bin/codex')) ? join(homedir(), '.local/bin/codex') : null);
export const gptAvailable = () => codexBin() !== null;
async function askCodex<T>(prompt: string, schema: object, timeoutMs: number, model: string): Promise<T> {
  const bin = codexBin();
  if (!bin) throw new Error('Codex is not installed on this machine.');
  const dir = mkdtempSync(join(tmpdir(), 'egg-codex-'));
  try {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema));
    const proc = Bun.spawn([bin, 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', ...(model ? ['--model', model] : []),
      '--output-schema', join(dir, 'schema.json'), '-o', join(dir, 'out.json'), '-'], { cwd: dir, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (proc.signalCode) throw new Error(`Codex took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`);
    if (!existsSync(join(dir, 'out.json'))) throw new Error(`Codex exited with code ${code}: ${(err || out).trim().slice(-300)}`);
    try { return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as T; } catch { throw new Error('Codex answered without the structured result.'); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
