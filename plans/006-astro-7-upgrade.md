# Plan 006: Upgrade to Astro 7 and clear the remaining XSS advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This is a **major version upgrade**; the plan
> deliberately tells you to stop rather than adapt when reality diverges.
>
> **Step 0 — align your worktree first (run before anything else).**
> Agent worktrees are branched from the session's starting commit, which is
> **behind** `main`. A previous run of this plan stopped here. Fix it before the
> drift check:
>
> ```bash
> git fetch origin
> git log --oneline main..HEAD    # MUST be empty — you have no unique work
> git reset --hard origin/main
> git log --oneline -1            # expect: ab9c2a8 or later
> ```
>
> If `git log --oneline main..HEAD` prints **anything**, STOP — the worktree has
> work that a reset would destroy, and that is not a situation this plan
> anticipates. Otherwise the reset is safe and authorised: it is an explicit
> instruction here, not improvisation.
>
> **Drift check (run after step 0)**: `grep '"astro"' package.json`
> Expect `"astro": "^6.4.8"`. If it still reads `^6.4.4` *after* the reset
> above, then you are genuinely not on the expected base — STOP and report
> which commit `git log --oneline -1` shows. (Do not conclude "plan 003 was
> never merged"; it was. The likely cause is a stale base commit.)
>
> **Plan 004 was deliberately NOT merged** — sharing a module forced Astro to
> stop inlining the component scripts, which cost a network round trip on every
> page. `src/components/Substrate.astro` and `src/components/DotMatrix.astro`
> still each carry their own `hash()`, colour read, and DPR clamp. That is
> intentional. Do not "fix" it.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans 001, 002, 003, 004 all merged to `main` first
- **Category**: migration / security
- **Planned at**: commit `3435350`, 2026-07-27

## Why this matters

Plan 003 patched Astro to 6.4.8 and cleared the HIGH host-header SSRF advisory,
but three XSS advisories remain: GHSA-4g3v-8h47-v7g6 (moderate),
GHSA-f48w-9m4c-m7f5 (moderate), and GHSA-7pw4-f3q4-r2p2 (low). Their affected
range is `astro >=2.9.0 <=7.0.9`. 6.4.8 is the newest release in the 6.x line,
so **no patch can clear them** — Astro 7.1+ is the only fix. That is why this
major upgrade is not optional hygiene.

Astro 7 (released 2026-06-22) rewrote the `.astro` compiler in Rust, replaced
the Markdown pipeline, and moved to Vite 8. Most of that does not touch this
repo, but two things could, and one could break the deploy. Read the risk
section carefully before starting.

## Current state

The site is a fully static Astro build (`output: 'static'`) serving two pages,
deployed by a Git-connected Cloudflare Worker that runs `bun run build` on every
push to `main`. **A push to `main` is a production deploy** — there is no
staging environment and no GitHub Actions workflow.

`package.json` after plan 003:

```json
  "dependencies": {
    "@astrojs/sitemap": "^3.7.3",
    "@fontsource-variable/mona-sans": "^5.2.8",
    "astro": "^6.4.8"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.9",
    "@biomejs/biome": "^2.4.16",
    "lefthook": "^2.1.9",
    "typescript": "^6.0.3",
    "wrangler": "^4.98.0"
  }
```

`astro.config.mjs` in full:

```js
// @ts-check
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://eggers.dev',
  output: 'static',
  integrations: [
    sitemap({
      // The 404 page is an error response, not a destination.
      filter: (page) => !page.includes('/404'),
    }),
  ],
  markdown: {
    // Dual-theme syntax highlighting for the harness excerpts; toggled by
    // prefers-color-scheme in global.css (see .astro-code styles).
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      wrap: false,
    },
  },
  devToolbar: { enabled: false },
})
```

### Risk assessment specific to this repo

I checked each Astro 7 breaking change against this codebase. Most do not apply.

**HIGH — Node version on the Cloudflare build.** Astro 7 declares
`engines.node: ">=22.12.0"`. This repo has **no `.nvmrc`, no `.node-version`,
and no `engines.node`**, so the Cloudflare Workers build uses whatever default
its image provides. If that default is below 22.12.0, the build fails *after*
the merge — which is also the deploy. Step 1 pins the version to remove this
risk before the upgrade, not after.

**MEDIUM — `<Code>` from `astro:components`.** `src/components/HowIWork.astro:2`
imports it and `:73` renders `<Code code={harness} lang="ts" themes={codeThemes} />`
with `codeThemes = { light: 'github-light', dark: 'github-dark-default' }`. This
is the harness snippet on the homepage — a visible, load-bearing element. The
API must be confirmed to survive; `.astro-code` styling in
`src/styles/global.css:413-427` depends on the class it emits.

**MEDIUM — `@astrojs/sitemap`.** The latest published version is **3.7.3**, the
same one installed; there is no v4 for Astro 7 yet, and the package declares no
peer dependency range, so nothing will hard-block at install time. Whether it
actually works under Astro 7 is unverified. `dist/sitemap-index.xml` and
`dist/sitemap-0.xml` must still be produced.

**LOW — the Sätteri Markdown processor replacing remark/rehype.** This would
matter if any Markdown used code fences or remark/rehype plugins. I checked:
`grep -rn '```' src/content/` returns **nothing** — none of the three work
entries contain a fenced code block, and no remark or rehype plugins are
configured. The `markdown.shikiConfig` block is therefore **vestigial**: per
Astro's docs the `<Code />` component does not inherit `shikiConfig`, and no
Markdown has code to highlight. Do not delete it in this plan (that is a
separate cleanup), but do not be alarmed if it becomes a no-op or warns.

**LOW — stricter Rust compiler (unclosed tags, invalid nesting).** The repo's
SVGs use `<path ...></path>`, which is *closed*, not unclosed. No `<div>` inside
`<p>` patterns found. Expect this to pass, but the compiler is the strictest new
thing in 7, so read its errors carefully if any appear.

**LOW — `compressHTML: 'jsx'` whitespace default.** The one at-risk element is
the wordmark at `src/components/Rail.astro:31`:
`<span class="rail__word">eggers<span class="rail__dot">.</span>dev</span>`.
It is written with no whitespace between the inline elements, so JSX-mode
stripping has nothing to strip. Verify it renders as `eggers.dev` and not
`eggers . dev` anyway.

**NOT APPLICABLE**: `src/fetch.ts` (does not exist), `@astrojs/db` (not used),
`astro:transitions` internals (no view transitions), experimental flags (none
set), custom Vite plugins (none).

**Repo conventions**: bun only, never npm/pnpm for installs (`AGENTS.md`).
Conventional Commits, no AI attribution footers.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Node version | `node --version` | >= v22.12.0 |
| Upgrade | `bunx @astrojs/upgrade` | astro + official integrations updated together |
| Audit | `bun audit` | no astro advisory block |
| Typecheck | `bun run check` | exit 0, `0 errors` |
| Lint | `bun run lint` | exit 0 |
| Build | `bun run build` | exit 0, "2 page(s) built" |
| Preview | `bun run preview` | serves http://localhost:4321 |

Note: fresh git worktree — run `bun install` first.

## Scope

**In scope**:
- `package.json`, `bun.lock`
- `.nvmrc` (create)
- `astro.config.mjs` — only if Astro 7 requires a config change
- `src/**` — **only** where the Astro 7 compiler or API forces a change, and
  only the minimum edit that satisfies it

**Explicitly out of scope**:
- Any refactor, cleanup, or improvement not forced by the upgrade. If you find
  yourself improving code, stop.
- Deleting the vestigial `markdown.shikiConfig` block — separate cleanup.
- `DESIGN.md`, `PRODUCT.md`, `AGENTS.md`, `README.md`.
- Bumping `wrangler`, `biome`, or `typescript` — one concern per change.
- `plans/` — your reviewer maintains the index.

## Steps

### Step 1 — Pin the Node version BEFORE upgrading

This de-risks the deploy and must happen first.

```bash
node --version    # must be >= v22.12.0; if not, STOP
```

The repo owner has specified **Node 24**. Create `.nvmrc` in the repo root
containing exactly:

```
24
```

Cloudflare Workers Builds reads `.nvmrc` to select the build image's Node
version, so this is the file that actually controls the deploy. Then add an
`engines.node` field to `package.json` recording Astro 7's real floor:

```json
  "engines": {
    "bun": ">=1.3.0",
    "node": ">=22.12.0"
  },
```

`.nvmrc` pins what the build uses (24); `engines.node` documents the minimum
that works (22.12.0) without over-constraining anyone running locally.
**Preserve the existing `bun` entry — add to the block, do not replace it.**

**Verify**:
```bash
cat .nvmrc
grep -A3 '"engines"' package.json
```

### Step 2 — Baseline everything

```bash
bun install
bun run build
bun audit 2>&1 | tee /tmp/audit-before.txt
grep -c "GHSA-4g3v-8h47-v7g6" /tmp/audit-before.txt   # expected: 1
ls dist/
cp dist/index.html /tmp/index-before.html
cp dist/404.html /tmp/404-before.html
```

Record the `ls dist/` output in your NOTES.

### Step 3 — Run the official upgrade tool

```bash
bunx @astrojs/upgrade
```

This updates `astro` and all official integrations (`@astrojs/sitemap`,
`@astrojs/check`) together, which is safer than bumping them individually.
Accept the upgrade when prompted.

**Verify**:
```bash
grep '"astro"' package.json      # expected: ^7.x
bun pm ls | grep -w astro        # expected: astro@7.1.4 or newer
```

If the tool leaves `@astrojs/sitemap` at 3.7.3, that is expected — no v4
exists. Note it and continue.

### Step 4 — Build and triage

```bash
bun run build
```

**If it succeeds**, go to step 5.

**If it fails**, triage against the risk list in "Current state" above:
- A compiler error about unclosed tags or invalid nesting → fix the specific
  markup it names, minimally. Allowed.
- An error about `<Code>` or `astro:components` → **STOP and report**. Do not
  swap in a different highlighter or hand-roll one.
- An error about `@astrojs/sitemap` → **STOP and report**. Do not remove the
  integration to make the build pass.
- Anything not on the risk list → **STOP and report**.

Fix at most the markup errors, then re-run. Do not make more than three
attempts before stopping.

### Step 5 — Verify the output survived

```bash
bun run check    # exit 0, 0 errors
bun run lint     # exit 0
bun run build    # exit 0, "2 page(s) built"
```

Content assertions:
```bash
grep -c "I build the systems that let agents ship real software" dist/index.html   # expected: 1
grep -c "brendan@eggers.dev" dist/index.html      # expected: >= 1
grep -c "astro-code" dist/index.html              # expected: >= 1  (the harness snippet)
grep -c "<canvas" dist/index.html                 # expected: >= 1
grep -c "<canvas" dist/404.html                   # expected: >= 1
grep -c "didn't make it through the gate" dist/404.html   # expected: 1
ls dist/sitemap-index.xml dist/sitemap-0.xml      # both must exist
```

The wordmark whitespace check:
```bash
grep -o 'rail__word[^<]*<[^>]*>[^<]*<[^>]*>[a-z]*' dist/index.html | head -1
```
Confirm it reads `eggers` `.` `dev` with no space introduced between them.

Sitemap correctness:
```bash
cat dist/sitemap-0.xml    # expected: one <loc> for https://eggers.dev/, no /404
```

### Step 6 — Confirm the advisories cleared

```bash
bun audit 2>&1 | tee /tmp/audit-after.txt
grep -c "GHSA-4g3v-8h47-v7g6" /tmp/audit-after.txt   # expected: 0
grep -c "GHSA-f48w-9m4c-m7f5" /tmp/audit-after.txt   # expected: 0
grep -c "GHSA-7pw4-f3q4-r2p2" /tmp/audit-after.txt   # expected: 0
```

Transitive advisories (`sharp`, `undici`, `postcss`, and others under
`wrangler > miniflare`) may remain — out of scope, as in plan 003.

### Step 7 — Runtime check

The homepage carries two canvas animations and a copy-to-clipboard button; the
build passing does not prove they run. If a browser is available, serve
`bun run preview` and load `/` and `/404`. Confirm: the dot field renders and
reacts to the pointer, the harness code block is syntax-highlighted in both
light and dark, the nav rail highlights on scroll, and the console is clean.

**If you cannot run a browser, write "runtime verification not performed, no
browser available" in your NOTES.** Do not claim it passed.

## Done criteria

1. `.nvmrc` exists and contains exactly `24`
2. `package.json` has `engines.node` set to `>=22.12.0`, with the `bun` entry preserved
3. `bun pm ls | grep -w astro` shows 7.1.4 or newer
4. `bun audit` shows none of GHSA-4g3v-8h47-v7g6, GHSA-f48w-9m4c-m7f5, GHSA-7pw4-f3q4-r2p2
5. `bun run check` exits 0 with `0 errors`
6. `bun run lint` exits 0
7. `bun run build` exits 0, "2 page(s) built"
8. All content assertions in step 5 pass, including `astro-code` present
9. `dist/sitemap-index.xml` and `dist/sitemap-0.xml` both exist, and
   `sitemap-0.xml` contains the site root and not `/404`
10. Every `src/` change (if any) is traceable to a specific compiler error you
    quoted in your report — no discretionary edits

## Test plan

No test suite exists and a major-upgrade plan is the wrong place to introduce
one. The gates are the typecheck, the build, the content assertions in step 5,
and the runtime check in step 7. The content assertions are the real test here:
they assert that the hero copy, the contact address, the syntax-highlighted
harness block, both canvases, and both sitemap files all survive the compiler
and pipeline swap. Do not add a test framework.

## STOP conditions

Stop immediately and report:

- Local `node --version` is below v22.12.0.
- `git log --oneline main..HEAD` is non-empty at step 0 (worktree has unique work).
- `package.json` still pins `astro` at `^6.4.4` **after** the step 0 reset —
  you are not on the expected base commit. Report the SHA; do not conclude that
  plan 003 was unmerged.
- Any build error naming `<Code>`, `astro:components`, or `@astrojs/sitemap`.
- Any build error not on the risk list in "Current state".
- Three build attempts have failed.
- `grep -c "astro-code" dist/index.html` returns 0 — the harness snippet lost
  its highlighting.
- Either sitemap file is missing from `dist/`.
- A fix would require changing rendered copy, redesigning a component, or
  removing a feature to make the build pass.
- `bun audit` still reports the three XSS advisories after a successful upgrade
  to 7.1.4+ (means the advisory range moved again — the reviewer needs to know).

## Maintenance note

`.nvmrc` and `engines.node` now encode a real deploy constraint, not a
preference — Cloudflare Workers Builds reads `.nvmrc`, and Astro 7 will not run
below 22.12.0. Anyone lowering either one breaks production silently, since the
failure surfaces only at deploy time. `@astrojs/sitemap` is pinned at a version
predating Astro 7; watch for a v4 and upgrade when it lands. The
`markdown.shikiConfig` block in `astro.config.mjs` is vestigial today (no
Markdown has code fences) — it becomes live again the moment anyone writes a
fenced block in a content entry, and under Sätteri that may need
`@astrojs/markdown-remark` instead. Note that in review if content grows.

## Git workflow

Commit in the worktree. Conventional Commits, no AI attribution footer.
Suggested message:

```
feat(deps)!: upgrade to Astro 7

Clears the last three XSS advisories (GHSA-4g3v-8h47-v7g6,
GHSA-f48w-9m4c-m7f5, GHSA-7pw4-f3q4-r2p2), which affect astro
>=2.9.0 <=7.0.9 and so could not be fixed anywhere in the 6.x line.

Pins Node via .nvmrc and engines.node first: Astro 7 requires >=22.12.0
and the Cloudflare build had no pin, so an unpinned upgrade risked
failing at deploy time rather than at build time.
```

Do not push. Do not merge. Your reviewer handles that.
