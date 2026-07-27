# Plan 007: Generate the resume PDF from the HTML instead of hand-syncing two files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If any
> STOP condition occurs, stop and report — do not improvise.
>
> **Step 0 — align your worktree first.** Agent worktrees branch from the
> session's starting commit, which may be behind `main`:
> ```bash
> git fetch origin
> git log --oneline main..HEAD    # MUST be empty
> git reset --hard origin/main
> ```
> If `main..HEAD` prints anything, STOP.

## Status

- **Priority**: P3
- **Effort**: S–M (depends on the approach chosen below)
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `6a1ded0`, 2026-07-27
- **Requested by**: the repo owner, who noted it "might not be worth the timing
  right now" — this plan exists so the idea survives, not because it is urgent.

## Why this matters

`resume/brendan-eggers-resume.html` and `resume/brendan-eggers-resume.pdf` are
two representations of one document, kept in step by hand. They are in sync
today (both were last written in `2797b6b`), and `AGENTS.md` now *promises* they
stay in sync — but nothing enforces it. The next person to fix a typo in the
HTML ships a PDF that disagrees with it, and the PDF is the artifact a recruiter
actually downloads. The failure is silent and the blast radius is the document
you are judged on.

## Current state

- `resume/brendan-eggers-resume.html` — a standalone, self-contained HTML file
  with an inline `<style>` block. Not built by Astro, not part of `src/`, not
  copied into `dist/`. It is opened directly in a browser.
- `resume/brendan-eggers-resume.pdf` — 130K, committed, rendered by hand.
- `package.json` scripts today: `dev`, `build`, `preview`, `check`, `format`,
  `lint`, `lint:fix`, `deploy`, `prepare`. **There is no resume script.**
- `AGENTS.md` Performance section names the PDF as a sanctioned committed binary
  "kept in sync with `resume/brendan-eggers-resume.html`".

**Neither file is published.** Nothing in `src/` links to the resume and it is
never copied into `dist/`, so it is reachable at no URL. That matters for the
approach decision below.

## The approach decision — resolve this before writing code

There is a real tension with this repo's conventions, and the executor should
not paper over it. `AGENTS.md` demands the repo stay lean; `PRODUCT.md` treats
speed and restraint as the product. Weigh these:

**Option A — local script using the system browser (recommended).** Add a
`resume:pdf` script that shells out to an already-installed Chrome/Chromium in
headless mode with `--print-to-pdf`. Zero new dependencies. Cost: it only works
on a machine that has Chrome, and it is not enforced in CI.

**Option B — add Playwright or Puppeteer as a devDependency.** Reliable and
scriptable anywhere. Cost: 200MB+ of browser binaries for one PDF, in a repo
whose stated rule is leanness. Note the owner deliberately deleted a
198MB Playwright cache from this machine earlier — do not reintroduce that
weight without explicit approval.

**Option C — enforce rather than generate.** Do not build the PDF at all. Add a
pre-commit check that fails if the HTML changed without the PDF changing in the
same commit. Near-zero cost, catches the actual failure mode (silent drift), but
still leaves rendering manual.

**Recommendation: A, with C as a cheap complement.** B is disproportionate for a
one-page document that is not currently published.

**If the resume ever gets published** (see plan notes in `plans/README.md` about
it being unreachable), revisit: at that point the PDF becomes a real build
artifact of the site, `dist/` should contain it, and generating it during
`bun run build` starts to make sense.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Build | `bun run build` | exit 0, "2 page(s) built" |
| Find a browser | `ls /Applications/Google\ Chrome.app/Contents/MacOS/` | the binary, or absent |

## Scope

**In scope**:
- `package.json` — one new script
- `scripts/` — a small shell or JS file if the command needs more than one line
- `AGENTS.md` / `README.md` — document the new command
- `lefthook.yml` — only if implementing Option C

**Out of scope**:
- The resume's content or styling. This plan changes how the PDF is produced,
  not what it says.
- Publishing the resume to `dist/` — a separate decision.
- Adding a heavy browser dependency without explicit approval (Option B).

## Steps

### Step 1 — Confirm the current pair is in sync

```bash
git log --format='%h %s' -1 -- resume/brendan-eggers-resume.html
git log --format='%h %s' -1 -- resume/brendan-eggers-resume.pdf
```
Both should name the same commit. If they do not, the files have **already**
drifted — STOP and report, because regenerating would silently overwrite
whichever is correct.

### Step 2 — Locate a browser binary

```bash
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null
ls "/Applications/Chromium.app/Contents/MacOS/Chromium" 2>/dev/null
which chromium chrome google-chrome-stable 2>/dev/null
```

If none is found, STOP and report — Option A is not viable on this machine and
the owner must choose B or C.

### Step 3 — Add the script

Add to `package.json`:

```json
"resume:pdf": "<browser> --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=resume/brendan-eggers-resume.pdf resume/brendan-eggers-resume.html"
```

Use the absolute path you found in step 2. If the flags differ for the browser
you found, adjust minimally and say so in your report. Prefer a `scripts/`
file over an unreadable one-liner if quoting gets ugly.

### Step 4 — Verify the generated PDF matches the committed one

```bash
cp resume/brendan-eggers-resume.pdf /tmp/pdf-before.pdf
bun run resume:pdf
ls -la resume/brendan-eggers-resume.pdf
```

The regenerated PDF will **not** be byte-identical (timestamps, generator
metadata, font subsetting all vary). That is expected. Verify the *content*
instead:

```bash
# page count and text should match
python3 -c "
import re,zlib,pathlib
d=pathlib.Path('resume/brendan-eggers-resume.pdf').read_bytes()
print('pages:', d.count(b'/Type /Page') or d.count(b'/Type/Page'))
print('size:', len(d))
"
```

Then **open the PDF and look at it**. Confirm: one page, the header block with
name and contact line, all six employers present, the Skills and Education
sections intact, nothing clipped at the page boundary. A PDF that generates
successfully but drops the last section is the failure mode here.

If the output is more than one page, the print flags need margin/scale tuning —
adjust and re-verify. STOP after three attempts.

### Step 5 — Document it

Add the command to `README.md` and to `AGENTS.md`'s command list, and amend the
`AGENTS.md` line that says the PDF is "kept in sync" so it names the script as
the mechanism.

### Step 6 — Verify nothing else broke

```bash
bun run lint && bun run check && bun run build
git status --short
```

## Done criteria

1. `bun run resume:pdf` regenerates `resume/brendan-eggers-resume.pdf` from the HTML
2. The regenerated PDF is **one page** and visually complete (checked by eye)
3. No new runtime or dev dependency was added (unless Option B was explicitly approved)
4. `README.md` and `AGENTS.md` document the command
5. `bun run lint`, `bun run check`, `bun run build` all pass
6. `resume/brendan-eggers-resume.html` content is unchanged

## Test plan

The meaningful test is visual: generate the PDF and look at it. There is no
assertion worth writing that catches "the PDF renders but the Skills section
fell off page two" better than opening it. If Option C is implemented, its test
is behavioural: stage a one-character HTML edit without touching the PDF and
confirm the hook rejects the commit, then unstage.

## STOP conditions

- Step 1 shows the HTML and PDF last changed in different commits (already drifted).
- No browser binary found in step 2.
- The generated PDF is more than one page after three attempts at flag tuning.
- Implementing this would require adding Playwright, Puppeteer, or another
  browser download without explicit approval.
- The generated PDF is visibly missing content present in the HTML.

## Maintenance note

The generated PDF will differ byte-for-byte on every run even with identical
input, so it will show as modified in `git status` whenever the script runs.
That is noise; only commit it when the HTML actually changed. If that becomes
annoying, Option C (a drift check) is the lower-friction answer than
regenerating on every build. Revisit the whole approach if the resume is ever
published to `dist/` — at that point it becomes a build artifact and the
calculus changes.

## Git workflow

Conventional Commits, no AI attribution footer. Do not push or merge.
