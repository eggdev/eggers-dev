# Plan 001: Make DESIGN.md, PRODUCT.md, and AGENTS.md describe the repo as it actually is

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 3435350..HEAD -- DESIGN.md PRODUCT.md AGENTS.md`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `3435350`, 2026-07-27

## Why this matters

This repo is a public portfolio for a senior engineer, and the site itself is
pitched as a work sample — `PRODUCT.md` says "the page is the proof." Three
documents currently contradict the repository they describe. `DESIGN.md` claims
no components exist when eleven do and the site is deployed. `PRODUCT.md` opens
with an unfilled scaffolding field. `AGENTS.md` states a rule the repo breaks in
two places. Anyone reading these — a recruiter browsing the public repo, or an
AI agent taking instruction from `AGENTS.md` — is misled. Docs that lie are
worse than absent docs because agents act on them.

## Current state

Three files, all in the repo root, all tracked by git.

**1. `DESIGN.md` lines 79–83** — the components section still describes an
unbuilt project:

```markdown
## 5. Components

*Seed mode: no components exist yet. The next `/impeccable document` run (scan mode, after the first build) will extract real component tokens and generate the `.impeccable/design.json` sidecar.*

Canonical primitives to define at build time, consistent with the rules above: text links (cobalt, with a precise underline/focus treatment), primary & ghost buttons (flat, hairline or filled-cobalt, white text on the cobalt fill), navigation (weight-driven, active-state by color), project / work entries (the signature component — flat, hairline-separated, type-led, *not* an identical-card grid), and the contact affordance (must be reachable within a glance from anywhere).
```

This is false. These components exist today in `src/components/`:
`About.astro`, `Builds.astro`, `Contact.astro`, `DotMatrix.astro`,
`Footer.astro`, `Hero.astro`, `HowIWork.astro`, `NightShift.astro`,
`Rail.astro`, `Substrate.astro`, `Work.astro`. The site is live at
https://eggers.dev.

**2. `PRODUCT.md` lines 1–7** — an unfilled scaffolding stub:

```markdown
# Product

## Register

brand

## Users
```

The `## Register` section's entire body is the single word `brand`. Every other
section in the file is several paragraphs of real content.

**3. `AGENTS.md` line 79** — a rule the repo violates:

```
  active state, the dot-matrix). Self-host fonts. Keep the repo lean: no media or
  build artifacts committed.
```

But `git ls-files` shows two committed binaries:
- `resume/brendan-eggers-resume.pdf` (130K) — a rendered artifact of the
  tracked `resume/brendan-eggers-resume.html`
- `public/og.png` (65K) — the social share card, referenced by
  `src/layouts/BaseLayout.astro:18` as `new URL('/og.png', Astro.site)`

These are deliberate and should stay. `og.png` is a required static asset. The
PDF is a deliverable a recruiter downloads. **The rule is what's wrong, not the
files.** Do not delete either binary.

**Repo conventions to match**: These are prose documents in a confident,
specific, unembellished voice — see `PRODUCT.md`'s "Brand Personality" section
for the register. Write plainly and concretely. Do not add emoji, do not add
bold mid-sentence for emphasis, and do not pad with filler. Keep the existing
heading structure and numbering in `DESIGN.md` intact.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Lint | `bun run lint` | exit 0, "No fixes applied" |
| Typecheck | `bun run check` | exit 0, `0 errors` |
| Build | `bun run build` | exit 0, "2 page(s) built" |
| Verify component list | `ls src/components/` | 11 `.astro` files |

Note: this is a fresh git worktree. Run `bun install` first — `node_modules`
is not shared from the main checkout.

## Scope

**In scope** (the only files you may modify):
- `DESIGN.md`
- `PRODUCT.md`
- `AGENTS.md`

**Explicitly out of scope** (do not touch, even if they look related):
- Any file under `src/` — this plan changes no code
- `README.md` — already corrected in a prior commit
- `resume/brendan-eggers-resume.pdf` and `public/og.png` — keep both
- `plans/` — your reviewer maintains the index

## Steps

### Step 1 — Rewrite `DESIGN.md` §5 to describe the real component set

Replace lines 79–83 (the `## 5. Components` heading through the "Canonical
primitives" paragraph) with an accurate description. Requirements:

- Keep the `## 5. Components` heading exactly as-is.
- Delete the italicised "Seed mode" sentence entirely — it is obsolete and
  references a tool run that already happened.
- Replace "Canonical primitives to define at build time" with a present-tense
  description of what exists. Keep the design intent that is still true (text
  links in cobalt, primary and ghost buttons, weight-driven navigation, work
  entries as hairline-separated and type-led rather than a card grid, the
  contact affordance reachable at a glance).
- Add a short list mapping the real components to their roles. Use the actual
  filenames. Group them so a reader understands the page: the rail/nav, the
  hero, the work list, the how-I-work section with its canvas diagram, about,
  contact, footer, and the two canvas dot-field components.
- Note that `Builds.astro` exists but is not currently rendered by any page,
  if it is still present when you run (check with
  `grep -rl "Builds.astro" src/ --include="*.astro"` — if only the component
  itself matches, it is unrendered).

**Verify**:
```bash
grep -c "Seed mode" DESIGN.md          # expected: 0
grep -c "no components exist yet" DESIGN.md   # expected: 0
grep -c "## 5. Components" DESIGN.md   # expected: 1
```

### Step 2 — Fill in or remove the `PRODUCT.md` Register stub

The `## Register` section (line 3) with body `brand` (line 5) is an unfilled
template field. Choose one:

- **Preferred**: give it real content. "Register" here means the design/voice
  register the product speaks in. The rest of the file already establishes it:
  confident, precise, considered; direct and unembellished; a senior
  practitioner letting the work carry the argument. Write two or three
  sentences that say this concretely, consistent with the "Brand Personality"
  section further down without simply duplicating it.
- **Acceptable**: delete the `## Register` heading and its one-word body
  entirely, so the file opens on `## Users`.

Do not leave a one-word section.

**Verify**:
```bash
# The literal one-word stub must be gone
awk '/^## Register$/{getline; getline; if ($0 == "brand") exit 1} END {exit 0}' PRODUCT.md
echo $?   # expected: 0
```

### Step 3 — Correct the `AGENTS.md` repo-leanness rule

The rule at line 79 says "no media or build artifacts committed" while the repo
commits two binaries on purpose. Amend the rule so it states the real policy
and names the two sanctioned exceptions with their reasons:

- `public/og.png` — the social share card; a required static asset.
- `resume/brendan-eggers-resume.pdf` — a rendered deliverable, kept in sync
  with `resume/brendan-eggers-resume.html`.

Keep the spirit of the original rule (the repo stays lean; don't commit build
output or stray media) while making the exceptions explicit so a future agent
doesn't "helpfully" delete them.

**Verify**:
```bash
git ls-files | grep -E "og\.png|resume\.pdf"   # expected: both still listed
grep -c "og.png" AGENTS.md                     # expected: >= 1
```

### Step 4 — Full verification

```bash
bun run lint     # exit 0
bun run check    # exit 0, 0 errors
bun run build    # exit 0, "2 page(s) built"
git status --short   # expected: only DESIGN.md, PRODUCT.md, AGENTS.md modified
```

## Done criteria

All must pass:

1. `grep -c "Seed mode" DESIGN.md` returns `0`
2. `grep -c "no components exist yet" DESIGN.md` returns `0`
3. `DESIGN.md` §5 names at least 6 real files from `src/components/`
4. `PRODUCT.md` has no section whose entire body is the word `brand`
5. `AGENTS.md` names both `og.png` and the resume PDF as sanctioned exceptions
6. `git ls-files | grep -E "og\.png|resume\.pdf"` still lists both files
7. `bun run lint` exits 0
8. `bun run check` exits 0 with `0 errors`
9. `bun run build` exits 0 and reports `2 page(s) built`
10. `git status --short` shows exactly three modified files, all `.md` in the repo root

## Test plan

This plan changes only Markdown prose; there is no test suite in this repo and
none is warranted here. The verification gates are the lint/typecheck/build
commands above plus the `grep` assertions in each step. Do not add a test
framework.

## STOP conditions

Stop immediately and report if any of these occur:

- The drift check shows `DESIGN.md`, `PRODUCT.md`, or `AGENTS.md` changed since
  commit `3435350` and the excerpts above no longer match the live text.
- `bun install` fails, or `bun run build` fails before you have made any edit
  (that means the worktree is broken, not your change).
- You conclude that `og.png` or the resume PDF should be deleted. They should
  not — that would be a scope violation. Report instead.
- Filling in the `## Register` section would require inventing product facts
  not already present in `PRODUCT.md`. Prefer deleting the section and report
  the choice.

## Maintenance note

`DESIGN.md` §5 will drift again the next time a component is added or removed —
it is now a hand-maintained list. Whoever adds a component should update that
section in the same commit. `AGENTS.md`'s exception list has the same property:
if a third binary is ever committed, it belongs in that list or it should not be
committed at all. In review, watch for anyone re-adding the `/impeccable
document` "seed mode" language; that tool run is long past.

## Git workflow

Commit your work in the worktree. Use Conventional Commits. Do **not** add
`Co-Authored-By`, "Generated with", or any AI attribution footer — the repo
owner's convention forbids them. Suggested message:

```
docs: correct DESIGN, PRODUCT, and AGENTS to match the real repo

DESIGN.md still claimed no components existed while eleven ship on a live
site. PRODUCT.md opened on an unfilled "Register: brand" scaffolding stub.
AGENTS.md banned committed media while the repo intentionally commits the
OG card and the rendered resume PDF; the rule now names both exceptions.
```

Do not push. Do not merge. Your reviewer handles that.
