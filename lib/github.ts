// GitHub, through the GitHub CLI's own sign-in on this machine (`gh auth login`, which is
// GitHub's OAuth device flow). The token stays in gh's keyring: this app never sees or stores it.
// `--stub-github` on server.ts (app.json's commands.server, so tests and verify) answers from a
// fixed sample instead, so a test never reaches GitHub.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inData } from './paths.ts';

export type HubRepo = { full: string; private: boolean; fork: boolean; archived: boolean; pushed: string; about: string };
export type Hub = { connected: boolean; login: string; error: string; repos: HubRepo[] };

const STUB = process.argv.includes('--stub-github');
const SAMPLE: Hub = { connected: true, login: 'ada', error: '', repos: [
  { full: 'ada/ledger', private: false, fork: false, archived: false, pushed: '2026-09-14T10:00:00Z', about: 'Double-entry ledger in Go' },
  { full: 'acme/billing-export', private: true, fork: false, archived: false, pushed: '2026-06-02T10:00:00Z', about: '' },
  { full: 'ada/dotfiles', private: false, fork: false, archived: true, pushed: '2019-01-20T10:00:00Z', about: '' },
] };

// Where clones are kept: beside the database.
export const REPOS = resolve(process.env.EGG_REPOS ?? inData('repos'));

async function gh(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string; err: string }> {
  if (!Bun.which('gh')) return { ok: false, out: '', err: 'The GitHub CLI (gh) is not installed on the server.' };
  const proc = Bun.spawn(['gh', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { ok: code === 0, out, err: err.trim() };
}

// EGG_STUB_REPOS=200 pads the sample to that many repositories, to see the picker at a real account's size.
const OWNERS = ['ada', 'acme', 'initech', 'globex'];
const padded = (n: number): Hub => ({ ...SAMPLE, repos: [...SAMPLE.repos, ...Array.from({ length: Math.max(0, n - SAMPLE.repos.length) }, (_, i) => ({
  full: `${OWNERS[i % OWNERS.length]}/service-${String(i + 1).padStart(3, '0')}`, private: i % 2 === 0, fork: i % 7 === 0, archived: i % 9 === 0,
  pushed: `${2026 - Math.floor(i / 24)}-${String(12 - (i % 12)).padStart(2, '0')}-01T10:00:00Z`, about: '' }))] });

let cache: { at: number; hub: Hub } | undefined;

// Who is signed in and every repository they can reach, most recently pushed first. Kept ten minutes.
export async function hub(fresh = false): Promise<Hub> {
  if (STUB) return process.env.EGG_STUB_REPOS ? padded(Number(process.env.EGG_STUB_REPOS)) : SAMPLE;
  if (!fresh && cache && Date.now() - cache.at < 600_000) return cache.hub;
  const me = await gh(['api', 'user', '--jq', '.login']);
  if (!me.ok) return { connected: false, login: '', repos: [], error: /not logged|auth login|401/i.test(me.err) || me.err === '' ? 'GitHub isn’t connected on the server. Run gh auth login there, then try again.' : me.err.split('\n')[0] };
  const list = await gh(['api', '--paginate', 'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    '--jq', '.[] | {full: .full_name, private: .private, fork: .fork, archived: .archived, pushed: (.pushed_at // ""), about: (.description // "")}'], 120_000);
  if (!list.ok) return { connected: true, login: me.out.trim(), repos: [], error: `Couldn’t list repositories: ${list.err.split('\n')[0]}` };
  const repos = list.out.split('\n').filter(Boolean).map((line) => JSON.parse(line) as HubRepo);
  cache = { at: Date.now(), hub: { connected: true, login: me.out.trim(), error: '', repos } };
  return cache.hub;
}

// The names and emails the person's commits carry in one repository: GitHub knows which commits
// are theirs whatever address they used at the time, and git needs those addresses to find them.
export async function authors(full: string, login: string): Promise<string[]> {
  const found = new Set<string>([login]);
  for (let page = 1; page <= 5; page++) {
    const r = await gh(['api', `repos/${full}/commits?author=${encodeURIComponent(login)}&per_page=100&page=${page}`, '--jq', '.[] | .commit.author | "\\(.name)\\n\\(.email)"']);
    if (!r.ok) break;
    const lines = r.out.split('\n').filter(Boolean);
    for (const l of lines) found.add(l);
    if (lines.length < 200) break;
  }
  return [...found];
}

// Clones a repository, or brings an earlier clone up to date. Answers its folder.
export async function clone(full: string): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(full)) throw new Error(`${full} is not a repository name.`);
  mkdirSync(REPOS, { recursive: true });
  const dir = join(REPOS, full.replace('/', '__'));
  if (existsSync(join(dir, '.git'))) {
    const pull = Bun.spawnSync(['git', '-C', dir, 'pull', '--ff-only', '--quiet'], { stdout: 'ignore', stderr: 'pipe' });
    if (pull.exitCode !== 0) console.log(`  could not update ${full}; reading the copy from last time`);
    return dir;
  }
  const r = await gh(['repo', 'clone', full, dir, '--', '--quiet'], 20 * 60_000);
  if (!r.ok) throw new Error(`Couldn’t clone ${full}: ${r.err.split('\n').pop() ?? 'gh failed'}`);
  return dir;
}
