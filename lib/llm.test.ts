// `bun test lib`: how a model call becomes a command. Nothing here runs a model or opens the database.
import { expect, test } from 'bun:test';
import { codexCommand, codexModel, codexUsage, llmBackend, parseCodexAnswer, strictSchema, usesCodex } from './llm.ts';

const base = { bin: '/bin/codex', tools: [] as string[], cwd: '/data/inbox', empty: '/tmp/egg-codex-x/work', schemaFile: '/tmp/egg-codex-x/schema.json', outFile: '/tmp/egg-codex-x/out.json' };
const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const configs = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));

test('EGG_LLM unset or "claude" keeps Claude for the Claude models', () => {
  for (const env of [{}, { EGG_LLM: '' }, { EGG_LLM: 'claude' }, { EGG_LLM: ' Claude ' }]) {
    expect(llmBackend(env)).toBe('claude');
    for (const m of ['opus', 'sonnet', 'haiku', 'claude-opus-x']) expect(usesCodex(m, env)).toBe(false);
  }
});

test('a "gpt" model goes to Codex under either backend', () => {
  for (const env of [{}, { EGG_LLM: 'codex' }]) for (const m of ['gpt', 'gpt:gpt-6-astra']) expect(usesCodex(m, env)).toBe(true);
});

test('EGG_LLM=codex sends every model to Codex', () => {
  for (const m of ['opus', 'sonnet', 'haiku', 'gpt', 'anything']) expect(usesCodex(m, { EGG_LLM: 'codex' })).toBe(true);
});

test('an unknown EGG_LLM stops the call', () => {
  expect(() => llmBackend({ EGG_LLM: 'openai' })).toThrow(/EGG_LLM/);
});

test('model names map to Codex models, with overrides', () => {
  expect(codexModel('opus', {})).toBe('gpt-6.1-sol');
  expect(codexModel('sonnet', {})).toBe('gpt-6.1-terra');
  expect(codexModel('haiku', {})).toBe('gpt-6-luna');
  expect(codexModel('opus', { EGG_CODEX_OPUS: 'gpt-6-astra' })).toBe('gpt-6-astra');
  expect(codexModel('sonnet', { EGG_CODEX_SONNET: 'x1' })).toBe('x1');
  expect(codexModel('haiku', { EGG_CODEX_HAIKU: 'x2' })).toBe('x2');
  expect(codexModel('opus', { EGG_CODEX_OPUS: '' })).toBe('gpt-6.1-sol'); // empty counts as unset
  expect(codexModel('gpt', {})).toBeUndefined();
  expect(codexModel('gpt:', {})).toBeUndefined();
  expect(codexModel('gpt:gpt-6-sol', {})).toBe('gpt-6-sol');
  expect(codexModel('some-other-model', {})).toBe('some-other-model');
});

test('the model and effort become -m and model_reasoning_effort', () => {
  const { args } = codexCommand({ ...base, model: 'sonnet', effort: 'low' }, {});
  expect(flag(args, '-m')).toBe('gpt-6.1-terra');
  expect(configs(args)).toContain('model_reasoning_effort="low"');
  const plain = codexCommand({ ...base, model: 'gpt' }, {}).args;
  expect(plain).not.toContain('-m');
  expect(configs(plain).some((c) => c.startsWith('model_reasoning_effort'))).toBe(false);
});

test('a call with no tools runs in the empty folder with the shell off', () => {
  const { args, cwd } = codexCommand({ ...base, model: 'opus' }, {});
  expect(cwd).toBe(base.empty);
  expect(flag(args, '-C')).toBe(base.empty);
  expect(args.filter((a, i) => args[i - 1] === '--disable')).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec']));
  expect(args.slice(0, 2)).toEqual(['/bin/codex', 'exec']);
  expect(flag(args, '--output-schema')).toBe(base.schemaFile);
  expect(flag(args, '-o')).toBe(base.outFile);
  expect(args.at(-1)).toBe('-'); // the prompt comes on stdin
});

test('a call with tools runs in its own folder with the shell on', () => {
  for (const tools of [['Read'], ['Read', 'Grep', 'Glob', 'Bash']]) {
    const { args, cwd } = codexCommand({ ...base, model: 'sonnet', tools, cwd: '/repos/some-repo' }, {});
    expect(cwd).toBe('/repos/some-repo');
    expect(flag(args, '-C')).toBe('/repos/some-repo');
    expect(args.filter((a, i) => args[i - 1] === '--disable')).not.toContain('shell_tool');
  }
});

test('every call is read-only, ephemeral and free of user settings, and never dangerous', () => {
  for (const tools of [[], ['Read'], ['Read', 'Grep', 'Glob', 'Bash']]) {
    for (const model of ['opus', 'sonnet', 'haiku', 'gpt', 'gpt:x']) {
      const { args } = codexCommand({ ...base, model, tools, effort: 'high', json: true }, {});
      expect(flag(args, '--sandbox')).toBe('read-only');
      expect(args.filter((a) => a === '--sandbox' || a === '-s')).toHaveLength(1);
      for (const f of ['--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']) expect(args).toContain(f);
      expect(configs(args)).toEqual(expect.arrayContaining(['approval_policy="never"', 'project_doc_max_bytes=0', 'web_search="disabled"']));
      const joined = args.join(' ');
      for (const bad of ['workspace-write', 'danger-full-access', '--dangerously', '--full-auto', '--yolo', '--add-dir', '--trust', '--approve-for-me', '--search', 'sandbox_mode'])
        expect(joined).not.toContain(bad);
    }
  }
});

test('a schema that already meets OpenAI\'s rules comes back unchanged', () => {
  const s = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: {
    a: { type: 'string', enum: ['x', 'y'] },
    b: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['c'], properties: { c: { type: 'number' } } } } } };
  expect(strictSchema(s)).toEqual(s);
});

test('a loose schema is made strict, nested ones too, and the input is kept', () => {
  const s = { type: 'object', required: ['a'], properties: {
    a: { type: 'string' }, b: { type: 'number' },
    list: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } } } },
    // A property named like a keyword is still a property.
    properties: { type: 'string' } } };
  const copy = structuredClone(s);
  const out = strictSchema(s) as Record<string, any>;
  expect(s).toEqual(copy);
  expect(out.additionalProperties).toBe(false);
  expect(out.required).toEqual(['a', 'b', 'list', 'properties']);
  expect(out.properties.a).toEqual({ type: 'string' });
  expect(out.properties.b).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
  expect(out.properties.properties).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  const item = out.properties.list.anyOf[0].items;
  expect(item.additionalProperties).toBe(false);
  expect(item.required).toEqual(['c']);
});

test('the answer is read with or without a code fence', () => {
  expect(parseCodexAnswer<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  expect(parseCodexAnswer<{ a: number }>('```json\n{"a":1}\n```\n')).toEqual({ a: 1 });
  expect(() => parseCodexAnswer('not json')).toThrow();
});

test('usage is summed from --json events, and other lines are skipped', () => {
  const jsonl = ['{"type":"thread.started"}', 'noise', '{"type":"item.completed","item":{"type":"command_execution"}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}'].join('\n');
  expect(codexUsage(jsonl)).toEqual({ tokensIn: 100, tokensOut: 20, commands: 1 });
  expect(codexUsage('')).toEqual({ tokensIn: undefined, tokensOut: undefined, commands: 0 });
});
