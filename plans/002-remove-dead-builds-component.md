# Plan 002: Delete the unrendered Builds.astro component

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 3435350..HEAD -- src/components/Builds.astro src/pages/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3435350`, 2026-07-27

## Why this matters

`src/components/Builds.astro` is committed to a public repository but imported
by nothing. It renders a "Side builds" section — 329 words of finished,
first-person marketing copy about the owner's personal projects — that no
visitor has ever seen. Dead components are a trap for the next reader: they
look like part of the site, so someone eventually edits them, or copies their
patterns, or wonders which of two similar sections is live. `AGENTS.md` states
"one concern each" for components and asks that the repo stay lean. Removing it
costs nothing (git keeps the content) and makes `src/components/` an honest
inventory of what actually ships.

## Current state

`src/components/Builds.astro` exists and is 100 lines. Its first 27 lines:

```astro
---
const builds = [
  {
    title: 'eggers.wedding',
    desc: 'A full wedding platform that runs my own wedding end to end: group RSVPs with two-way Zola sync, a Spotify song list, a seating chart, and an authenticated admin app, with an autonomous nightly agent doing repo cleanup.',
    link: { label: 'eggers.wedding', href: 'https://eggers.wedding' },
  },
  {
    title: 'A watcher on a Jetson',
    desc: "A self-hosted AI agent on a Jetson Orin Nano keeps an eye on my place, where a Furbo used to sit. I'd rather run something I can actually program.",
  },
  {
    title: 'reMarkable to shipped code',
    desc: "When an idea hits and I'm away from my desk, I write it out longhand on a reMarkable and hand the pages to an agent that starts building before I'm back.",
  },
]
---

<section id="builds" class="section">
  <div class="container">
    <header class="section-head">
      <h2 class="h-section">Side builds</h2>
      <p class="lede">
        The same harness-and-agents playbook shows up in the things I make for myself. The wedding
        is just the project with a date on it.
      </p>
    </header>
```

**It is imported nowhere.** The only page in the site is
`src/pages/index.astro`, which imports exactly these components:

```astro
import About from '../components/About.astro'
import Contact from '../components/Contact.astro'
import Footer from '../components/Footer.astro'
import Hero from '../components/Hero.astro'
import HowIWork from '../components/HowIWork.astro'
import Rail from '../components/Rail.astro'
import Substrate from '../components/Substrate.astro'
import Work from '../components/Work.astro'
import BaseLayout from '../layouts/BaseLayout.astro'
```

`src/pages/404.astro` imports only `DotMatrix.astro` and `BaseLayout.astro`.
`NightShift.astro` is imported by `HowIWork.astro`. That accounts for every
component except `Builds.astro`.

**CSS note**: `Builds.astro` uses the shared classes `.section`, `.container`,
`.section-head`, `.h-section`, `.lede`, and `.link-arrow`, all defined in
`src/styles/global.css` and all used by other live components. It also defines
its own scoped `<style>` block for `.builds`, `.build`, `.build__head`,
`.build__title`, and `.build__link`. Because Astro scopes component styles, that
block dies with the file. **Do not touch `src/styles/global.css`** — every class
`Builds.astro` borrows is still needed by live components.

**Repo conventions**: Components are PascalCase `.astro` files in
`src/components/`, one concern each (`AGENTS.md`). Deletions here are ordinary —
the blog was removed the same way in commits `aebddbc` and `70ad15c`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Confirm no importers | `grep -rn "Builds" src/ --include="*.astro"` | only `src/components/Builds.astro` itself |
| Lint | `bun run lint` | exit 0, "No fixes applied" |
| Typecheck | `bun run check` | exit 0, `0 errors` |
| Build | `bun run build` | exit 0, "2 page(s) built" |

Note: this is a fresh git worktree. Run `bun install` first — `node_modules`
is not shared from the main checkout.

## Scope

**In scope** (the only file you may modify):
- `src/components/Builds.astro` (delete)

**Explicitly out of scope** (do not touch):
- `src/styles/global.css` — the classes Builds borrowed are shared and live
- Any other component, even ones with similar structure
- `src/pages/index.astro` — it never referenced Builds; no edit needed
- `DESIGN.md` / `AGENTS.md` — a separate plan updates docs
- `plans/` — your reviewer maintains the index

## Steps

### Step 1 — Prove it is unreferenced

Before deleting anything, confirm the component is genuinely orphaned:

```bash
grep -rn "Builds" src/ --include="*.astro"
```

**Expected**: exactly one file matches — `src/components/Builds.astro` itself
(its own `<section id="builds">` markup and scoped CSS). If any *other* file
matches, that is a STOP condition.

Also check for indirect references:

```bash
grep -rn "builds\|Side builds" src/ --include="*.ts" --include="*.md" --include="*.css"
```

**Expected**: no matches, or matches only inside `src/components/Builds.astro`.

### Step 2 — Record the content before deleting

Run this and keep the output for your report, so the reviewer can confirm what
was removed:

```bash
git log --oneline -1 -- src/components/Builds.astro
wc -l src/components/Builds.astro
```

The content stays recoverable in git history after deletion. Note the commit
SHA in your NOTES.

### Step 3 — Delete the file

```bash
git rm src/components/Builds.astro
```

### Step 4 — Verify the site still builds identically

```bash
bun run lint     # exit 0
bun run check    # exit 0, 0 errors
bun run build    # exit 0, "2 page(s) built"
```

Then confirm nothing about the rendered output changed. The component was never
rendered, so the built HTML must be byte-identical in structure:

```bash
grep -c "Side builds" dist/index.html   # expected: 0
grep -c "id=\"builds\"" dist/index.html # expected: 0
grep -c "eggers.wedding" dist/index.html # expected: 0
```

All three must have been 0 *before* your change too — that is the proof the
component was dead. If any was non-zero before deletion, STOP.

### Step 5 — Confirm the component inventory

```bash
ls src/components/*.astro | wc -l   # expected: 10 (was 11)
```

## Done criteria

All must pass:

1. `src/components/Builds.astro` no longer exists on disk
2. `git status --short` shows exactly one change: `D src/components/Builds.astro`
3. `grep -rn "Builds" src/ --include="*.astro"` returns no matches
4. `ls src/components/*.astro | wc -l` returns `10`
5. `bun run lint` exits 0
6. `bun run check` exits 0 with `0 errors`
7. `bun run build` exits 0 and reports `2 page(s) built`
8. `grep -c "Side builds" dist/index.html` returns `0`
9. `src/styles/global.css` is unmodified (`git diff --stat` shows no entry for it)

## Test plan

No test suite exists in this repo and none is warranted for deleting an
unreferenced file. The verification is behavioural: the build must still
produce two pages, and the built HTML must not lose any content (because the
component contributed none). Do not add a test framework.

## STOP conditions

Stop immediately and report if any of these occur:

- Step 1's grep finds `Builds` referenced by any file other than
  `src/components/Builds.astro` itself. That means it is live and this plan's
  premise is wrong.
- `grep -c "Side builds" dist/index.html` is non-zero on a build made *before*
  your deletion. Same reason.
- `bun run build` fails after the deletion — that would mean something depended
  on the file after all.
- You find yourself wanting to edit `src/styles/global.css` to remove "now
  unused" classes. Those classes are shared with live components. Report
  instead of editing.

## Maintenance note

The copy in this component is genuinely good and the owner may want a "Side
builds" section later. It is preserved in git history — recover it with
`git show <SHA>:src/components/Builds.astro` using the SHA recorded in step 2.
If it is ever revived, it will need to be imported and placed in
`src/pages/index.astro` between `HowIWork` and `About`, and its `#builds`
anchor added to the `links` array in `src/components/Rail.astro`. Watch in
review for anyone re-adding a component without wiring it into a page — that is
exactly how this one became dead.

## Git workflow

Commit your work in the worktree. Use Conventional Commits. Do **not** add
`Co-Authored-By`, "Generated with", or any AI attribution footer — the repo
owner's convention forbids them. Suggested message:

```
chore: delete the unrendered Builds.astro component

Imported by nothing since it was written, so its "Side builds" section has
never reached a visitor. The copy stays recoverable in git history if the
section is ever revived.
```

Do not push. Do not merge. Your reviewer handles that.
