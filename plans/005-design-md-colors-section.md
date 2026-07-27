# Plan 005: Replace DESIGN.md §2's unresolved colour placeholders with the shipped tokens

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 3435350..HEAD -- DESIGN.md src/styles/global.css`
> `DESIGN.md` is expected to have changed (plan 001 rewrote §5). Confirm §2 and
> line 1 still match the excerpts below before proceeding; on a mismatch in
> those specific places, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-docs-truth-up.md (must land first — same file)
- **Category**: docs
- **Planned at**: commit `3435350`, 2026-07-27
- **Found by**: the plan 001 executor, while fixing §5. The original audit
  checked §5 and missed that §2 has the same defect.

## Why this matters

`DESIGN.md` is the design system of record — `AGENTS.md` calls its rules
"non-negotiable" and points agents at it for the full spec. Section 2 still
reads as an unbuilt project: it announces that "final OKLCH values are resolved
at implementation" and carries six `[to be resolved]` placeholders. The values
were resolved months ago and ship in `src/styles/global.css`. An agent told to
treat this file as authoritative finds placeholders where the palette should be,
and either invents values or asks. Plan 001 fixed exactly this defect in §5;
this is the same defect in the section above it.

## Current state

**1. `DESIGN.md` line 31** — a seed note that outlived its purpose:

```markdown
*Seed mode: final OKLCH values are resolved at implementation. The anchor and hue families below are committed; exact lightness/chroma per theme are tuned against live contrast.*
```

**2. Six `[to be resolved]` placeholders remain in §2.** Find them with
`grep -n "to be resolved" DESIGN.md`.

**3. `DESIGN.md` line 1** — a stale HTML comment instructing a tool re-run:

```html
<!-- SEED: re-run /impeccable document ... -->
```

Confirm its exact text with `sed -n '1p' DESIGN.md` before removing it.

**The real values ship in `src/styles/global.css`.** The cobalt family, at
`global.css:10-12`:

```css
  --cobalt: oklch(0.55 0.12 238); /* brand fill / focus */
  --cobalt-ink: oklch(0.48 0.13 238); /* cobalt as TEXT on light (≥4.5:1) */
  --cobalt-strong: oklch(0.42 0.14 240); /* hover/active for links */
```

Read the full `:root` block and the dark-theme block in `global.css` for the
rest — the neutrals, the surface tones, the hairlines, the warm counter-accent,
and the `--dot` / `--dot-accent` tokens the canvas fields read.

**Method note, and this is the important part**: transcribe the values from
`global.css`. Do **not** invent, round, or "improve" any number, and do not
reconcile a doc/CSS disagreement by changing the CSS. The CSS is what ships and
is therefore correct by definition. If a documented intent genuinely conflicts
with a shipped value, say so in your report and leave both alone.

**Repo conventions**: match the voice and structure plan 001 established in §5 —
present tense, describing what ships, concrete and unembellished. Keep §2's
existing subsection headings (`### Primary`, `### Secondary`, `### Neutral`,
`### Named Rules`) and the section numbering intact. Note that the light and
dark themes are both first-class (`AGENTS.md`), so a token with two values
needs both recorded.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Read the tokens | `sed -n '1,80p' src/styles/global.css` | the `:root` block |
| Find dark theme | `grep -n "prefers-color-scheme" src/styles/global.css` | the dark block's line |
| Lint | `bun run lint` | exit 0 |
| Typecheck | `bun run check` | exit 0, `0 errors` |
| Build | `bun run build` | exit 0, "2 page(s) built" |

Note: this is a fresh git worktree. Run `bun install` first.

## Scope

**In scope** (the only file you may modify):
- `DESIGN.md` — §2 Colors, and the stale HTML comment on line 1

**Explicitly out of scope**:
- `src/styles/global.css` — read it, never edit it. It is the source of truth.
- `DESIGN.md` §5 — plan 001 owns it; leave it exactly as you find it.
- Every other section of `DESIGN.md`.
- `AGENTS.md`, `PRODUCT.md`, `README.md`.
- `plans/` — your reviewer maintains the index.

## Steps

### Step 1 — Read the shipped palette

```bash
sed -n '1,80p' src/styles/global.css
grep -n "prefers-color-scheme" src/styles/global.css
```

Read both the light `:root` block and the dark override. List every colour token
and its value(s) before you write anything.

### Step 2 — Rewrite §2 with the real values

- Delete the "Seed mode" sentence at line 31 entirely.
- Replace each `[to be resolved]` placeholder with the actual value from
  `global.css`. Where a token differs between light and dark, give both.
- Keep the existing subsection headings and the prose that is still accurate —
  the palette's *intent* (cool near-monochrome base, cobalt carrying meaning, a
  warm counter-accent held in reserve) is still true and well written. You are
  filling in facts, not rewriting the section's argument.
- Where a token has an explanatory comment in the CSS (for example
  `/* cobalt as TEXT on light (≥4.5:1) */`), carry that reasoning into the doc.
  It records why two similar cobalts exist, which is the useful part.

**Verify**:
```bash
grep -c "to be resolved" DESIGN.md   # expected: 0
grep -c "Seed mode" DESIGN.md        # expected: 0
grep -c "oklch" DESIGN.md            # expected: >= 6
grep -c "## 2. Colors" DESIGN.md     # expected: 1
```

### Step 3 — Remove the stale seed comment on line 1

```bash
sed -n '1,8p' DESIGN.md
```

If line 1 is an HTML comment instructing an `/impeccable document` re-run,
delete that line. Leave the `# Design System: eggers.dev` heading and everything
else untouched.

**Verify**:
```bash
grep -c "SEED" DESIGN.md          # expected: 0
head -1 DESIGN.md                 # expected: the title heading, not a comment
```

### Step 4 — Confirm every documented value matches the CSS

For each OKLCH value you wrote into `DESIGN.md`, confirm the identical string
appears in `src/styles/global.css`:

```bash
grep -o 'oklch([^)]*)' DESIGN.md | sort -u > /tmp/doc-colors.txt
grep -o 'oklch([^)]*)' src/styles/global.css | sort -u > /tmp/css-colors.txt
comm -23 /tmp/doc-colors.txt /tmp/css-colors.txt
```

**Expected**: empty output — every value in the doc exists in the CSS. Any line
printed is a value you invented or mistyped. Fix it before continuing.

### Step 5 — Full verification

```bash
bun run lint     # exit 0
bun run check    # exit 0, 0 errors
bun run build    # exit 0, "2 page(s) built"
git status --short   # expected: only DESIGN.md modified
```

## Done criteria

All must pass:

1. `grep -c "to be resolved" DESIGN.md` returns `0`
2. `grep -c "Seed mode" DESIGN.md` returns `0`
3. `grep -c "SEED" DESIGN.md` returns `0`
4. `grep -c "oklch" DESIGN.md` returns `>= 6`
5. The `comm` check in step 4 prints nothing — no invented values
6. `src/styles/global.css` is unmodified
7. `DESIGN.md` §5 is unmodified relative to the branch you started from
8. `bun run lint` exits 0
9. `bun run check` exits 0 with `0 errors`
10. `bun run build` exits 0, "2 page(s) built"
11. `git status --short` shows exactly one modified file: `DESIGN.md`

## Test plan

Markdown prose only; no test suite exists and none is warranted. The real
verification gate is step 4's `comm` check — it mechanically proves every colour
in the doc traces to a colour in the shipping CSS, which is the one failure mode
that matters here (a design doc that confidently states a wrong hex is worse
than one with an honest placeholder). Do not add a test framework.

## STOP conditions

Stop immediately and report if any of these occur:

- Plan 001 has not landed and §5 still contains "no components exist yet". This
  plan depends on it; two agents editing `DESIGN.md` will conflict.
- Line 1 is not a stale seed comment. Report what it actually is; do not delete
  a line you cannot identify.
- The `comm` check in step 4 keeps printing values after you have corrected
  them — that means you are reading a different source than the CSS.
- A documented design intent contradicts a shipped CSS value (for example, the
  doc says the warm accent is reserved for one job but the CSS uses it in
  three). Report the conflict. Do **not** resolve it by editing the CSS.
- You find yourself wanting to change `src/styles/global.css` for any reason.

## Maintenance note

§2 now hand-mirrors `global.css`, so the two can drift again — a token renamed
in CSS will not update the doc. The `comm` check in step 4 is the cheap
regression test; anyone changing the palette should re-run it. The deeper fix is
generating this section from the CSS custom properties, which is more machinery
than a one-page portfolio warrants today, but is the obvious move if the design
system ever outgrows one file.

## Git workflow

Commit your work in the worktree. Use Conventional Commits. Do **not** add
`Co-Authored-By`, "Generated with", or any AI attribution footer. Suggested
message:

```
docs(design): fill in the real colour tokens in DESIGN.md §2

Six [to be resolved] placeholders and a "values are resolved at
implementation" note survived long after the palette shipped in
global.css. Every value is transcribed from the CSS, which stays the
source of truth.
```

Do not push. Do not merge. Your reviewer handles that.
