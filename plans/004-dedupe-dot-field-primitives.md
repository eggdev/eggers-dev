# Plan 004: Extract the shared dot-field primitives into one module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 3435350..HEAD -- src/components/Substrate.astro src/components/DotMatrix.astro`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3435350`, 2026-07-27

## Why this matters

`DESIGN.md` and `AGENTS.md` both describe the dot-matrix as **the one signature
animation** — singular. It is implemented twice. `Substrate.astro` (the
full-bleed field behind every page) and `DotMatrix.astro` (the field behind the
404 page) each carry their own copy of the same hashing function, the same
CSS-variable colour reading, and the same device-pixel-ratio clamp. When the
owner tunes the signature visual, there are two places to change and no
compiler error if only one gets changed — the two pages drift apart silently.

**Read this before you start — the scope is deliberately narrow.** These two
components are *not* redundant and you are **not** merging them. They size
themselves differently (one tracks the viewport, one tracks its parent element)
and track the pointer in different coordinate spaces. Collapsing them would risk
the signature visual on every page for little gain. This plan extracts only the
genuinely identical primitives — roughly 20 lines — into one module and leaves
both components' rendering and tuning exactly as they are.

## Current state

Two components, both canvas 2D, both in `src/components/`.

**`src/components/Substrate.astro`** (158 lines) — fixed, full-viewport,
rendered on the homepage by `src/pages/index.astro`. Sizes to
`window.innerWidth/innerHeight`. Tracks the pointer in **viewport** coordinates
(`e.clientX/clientY`). Gated behind a `(hover: hover) and (pointer: fine)`
media query. Reads its CSS variables from `document.documentElement`.

**`src/components/DotMatrix.astro`** (236 lines) — element-sized, accepts props
(`variant`, `accent`, `intensity`, `interactive`, `class`), supports multiple
instances via an internal `Field` type. Rendered only by `src/pages/404.astro`.
Sizes to `el.getBoundingClientRect()`. Reads its CSS variables from its own
element (`f.el`), which matters because it is scoped per-instance.

### The genuinely duplicated code

**1. `hash()` — byte-identical in both files.**

`src/components/Substrate.astro:50-53`:
```ts
    function hash(i: number, j: number) {
      const n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
      return n - Math.floor(n)
    }
```

`src/components/DotMatrix.astro:90-93`:
```ts
  // deterministic per-cell hash → stable accent placement, no Math.random flicker
  function hash(i: number, j: number) {
    const n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
    return n - Math.floor(n)
  }
```

**2. `TAU` — identical constant.** `Substrate.astro:34` and
`DotMatrix.astro:85` both declare `const TAU = Math.PI * 2`.

**3. Colour reading — same variables, same fallbacks, different source element.**

`src/components/Substrate.astro:55-59`:
```ts
    function readColors() {
      const cs = getComputedStyle(document.documentElement)
      dot = cs.getPropertyValue('--dot').trim() || 'gray'
      dotAccent = cs.getPropertyValue('--dot-accent').trim() || 'blue'
    }
```

`src/components/DotMatrix.astro:95-99`:
```ts
  function readColors(f: Field) {
    const cs = getComputedStyle(f.el)
    f.dot = cs.getPropertyValue('--dot').trim() || 'gray'
    f.dotAccent = cs.getPropertyValue('--dot-accent').trim() || 'blue'
  }
```

**4. The DPR clamp — identical expression.** `Substrate.astro:65` and
`DotMatrix.astro:105` both compute
`Math.min(window.devicePixelRatio || 1, 2)`.

### What is NOT duplicated — leave all of this alone

- Sizing. Substrate: `w = window.innerWidth`. DotMatrix: `getBoundingClientRect()`.
- Pointer space. Substrate stores raw `clientX/clientY`; DotMatrix stores
  element-relative coordinates.
- Tuning constants. Substrate: `RADIUS 1.6`, `ACCENT 0.04`, `BLOOM 150`, wave
  `0.011`, time `0.00045`, responsive `gap = w < 640 ? 36 : 28`. DotMatrix:
  per-instance `gap`/`radius`/`accentFrac`/`intensity` from props, influence
  `130`, wave `0.012`, time `0.00055`. **These numbers are art direction. Do not
  unify, average, or "clean up" any of them.**
- Lifecycle. Substrate uses `visibilitychange`; DotMatrix uses its own
  `visible` flag. Leave both.

**Repo conventions**: TypeScript is strict (`tsconfig.json`). Astro processes
and bundles `<script>` tags, so a component script may `import` from a module
under `src/`. There is currently **no** `src/lib/` directory — you are creating
it. Formatting is Biome: single quotes, no semicolons, 2-space indent — match
the surrounding files exactly and run `bun run lint:fix` before finishing.
Comments in this repo explain *why*, not *what* (see the existing comment on
`DotMatrix.astro:89`). Keep that habit.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Typecheck | `bun run check` | exit 0, `0 errors` |
| Lint | `bun run lint` | exit 0, "No fixes applied" |
| Autofix format | `bun run lint:fix` | exit 0 |
| Build | `bun run build` | exit 0, "2 page(s) built" |
| Preview | `bun run preview` | serves on http://localhost:4321 |

Note: this is a fresh git worktree. Run `bun install` first — `node_modules`
is not shared from the main checkout.

## Scope

**In scope**:
- `src/lib/dot-field.ts` (create)
- `src/components/Substrate.astro` (import the shared helpers; delete its local copies)
- `src/components/DotMatrix.astro` (same)

**Explicitly out of scope** (do not touch):
- **`AGENTS.md`** — its structure list will need a `src/lib/` line, but a
  concurrent plan is editing that file. Note it in your report; do not edit it.
- `src/styles/global.css` — the `--dot` / `--dot-accent` tokens stay as they are.
- `src/pages/index.astro`, `src/pages/404.astro` — neither needs a change.
- Every tuning constant listed under "What is NOT duplicated" above.
- The `draw()` function in either component. You are not touching rendering.
- `plans/` — your reviewer maintains the index.

## Steps

### Step 1 — Baseline the current output

```bash
bun install
bun run build
shasum dist/index.html dist/404.html
grep -c "substrate" dist/index.html    # record this number
```

Record all of it in your NOTES. Also confirm both canvases ship today:

```bash
grep -c "<canvas" dist/index.html   # expected: >= 1
grep -c "<canvas" dist/404.html     # expected: >= 1
```

### Step 2 — Create `src/lib/dot-field.ts`

Create the directory and the module. It exports exactly four things and
contains **no** rendering logic:

- `TAU` — the `Math.PI * 2` constant.
- `hash(i: number, j: number): number` — moved verbatim from either component
  (they are identical). Keep DotMatrix's explanatory comment about deterministic
  accent placement.
- `readDotColors(el: Element): { dot: string; dotAccent: string }` — reads
  `--dot` and `--dot-accent` off the element passed in, with the existing
  `'gray'` / `'blue'` fallbacks. Taking the element as a parameter is what lets
  both callers share it: Substrate will pass `document.documentElement`,
  DotMatrix will pass its own element.
- `capDpr(): number` — returns `Math.min(window.devicePixelRatio || 1, 2)`.

Write it in the repo's style: strict TypeScript, single quotes, no semicolons,
a short file-header comment explaining why the module exists (one signature
animation, two mounting contexts).

**Verify**:
```bash
bun run check    # exit 0, 0 errors
test -f src/lib/dot-field.ts && echo OK
```

### Step 3 — Wire `Substrate.astro` to the module

In its `<script>` block:
- Add an import for `TAU`, `hash`, `readDotColors`, `capDpr` from `../lib/dot-field`.
- Delete the local `const TAU = Math.PI * 2` and the local `hash` function.
- Replace the body of its `readColors()` with a call to
  `readDotColors(document.documentElement)`, assigning to the existing `dot` and
  `dotAccent` variables. **Keep the `readColors()` wrapper function** — it is
  called from three places (initial setup, and the `darkMQ` change listener).
- Replace the DPR expression in `resize()` with `capDpr()`.

Change nothing else. `RADIUS`, `ACCENT`, `BLOOM`, `fine`, the `draw()` body, and
every listener stay exactly as they are.

**Verify**:
```bash
bun run check                                          # exit 0
grep -c "Math.sin(i \* 12.9898" src/components/Substrate.astro   # expected: 0
grep -c "dot-field" src/components/Substrate.astro     # expected: 1
grep -c "RADIUS = 1.6" src/components/Substrate.astro  # expected: 1 (unchanged)
grep -c "BLOOM = 150" src/components/Substrate.astro   # expected: 1 (unchanged)
```

### Step 4 — Wire `DotMatrix.astro` to the module

Same treatment:
- Import the four helpers from `../lib/dot-field`.
- Delete its local `TAU` and `hash`.
- Rewrite `readColors(f: Field)` to call `readDotColors(f.el)` and assign onto
  `f.dot` / `f.dotAccent`. Keep the `Field`-taking signature — it is called
  per-instance.
- Replace the DPR expression in `resize(f)` with `capDpr()`.

The `Field` type, the props interface, `draw()`, and all tuning stay untouched.

**Verify**:
```bash
bun run check                                          # exit 0
grep -c "Math.sin(i \* 12.9898" src/components/DotMatrix.astro   # expected: 0
grep -c "dot-field" src/components/DotMatrix.astro     # expected: 1
grep -c "influence = 130" src/components/DotMatrix.astro  # expected: 1 (unchanged)
```

### Step 5 — Format, build, and prove the output survived

```bash
bun run lint:fix
bun run lint     # exit 0, "No fixes applied"
bun run check    # exit 0, 0 errors
bun run build    # exit 0, "2 page(s) built"
```

Then confirm both canvases still ship and the pages are intact:

```bash
grep -c "<canvas" dist/index.html    # expected: >= 1
grep -c "<canvas" dist/404.html      # expected: >= 1
grep -c "I build the systems that let agents ship real software" dist/index.html   # expected: 1
grep -c "didn't make it through the gate" dist/404.html    # expected: 1
```

### Step 6 — Check for runtime errors

The canvases are client-side; a build that succeeds can still throw at runtime.
If a browser or headless browser is available to you, load
`http://localhost:4321/` and `http://localhost:4321/404` from `bun run preview`
and confirm the console is clean and the dot field renders and reacts to the
pointer.

**If you have no way to run a browser, say so explicitly in your NOTES** —
write "runtime verification not performed, no browser available". Do not claim
it passed. Your reviewer will run it.

## Done criteria

All must pass:

1. `src/lib/dot-field.ts` exists and exports `TAU`, `hash`, `readDotColors`, `capDpr`
2. `grep -c "Math.sin(i \* 12.9898" src/components/Substrate.astro` returns `0`
3. `grep -c "Math.sin(i \* 12.9898" src/components/DotMatrix.astro` returns `0`
4. Both components import from `../lib/dot-field`
5. Every tuning constant is unchanged: `RADIUS = 1.6`, `ACCENT = 0.04`,
   `BLOOM = 150` in Substrate; `influence = 130` in DotMatrix
6. `bun run check` exits 0 with `0 errors`
7. `bun run lint` exits 0 reporting "No fixes applied"
8. `bun run build` exits 0 and reports `2 page(s) built`
9. `grep -c "<canvas" dist/index.html` and `dist/404.html` are both `>= 1`
10. `git status --short` shows exactly: new `src/lib/dot-field.ts`, modified
    `Substrate.astro`, modified `DotMatrix.astro` — nothing else
11. Net line count went **down** across the two components
    (`git diff --stat` on them shows more deletions than insertions)

## Test plan

This repo has no test suite and adding one for a canvas animation is not
warranted — the behaviour is visual and the render loop is not meaningfully
unit-testable without a DOM harness this project does not have. **Do not add a
test framework.**

Verification is the typecheck (which now proves both components agree on the
helper signatures — the compiler is the regression guard this refactor buys),
the build, the HTML content assertions in step 5, and the runtime check in
step 6. If you want extra confidence, confirm `hash(0,0)` and `hash(3,7)`
produce the same values before and after by running the old and new function
side by side in a scratch script — then delete the scratch file.

## STOP conditions

Stop immediately and report if any of these occur:

- The drift check shows either component changed since commit `3435350` and the
  excerpts above no longer match.
- `bun run check` reports type errors you cannot resolve **without** touching
  rendering logic or tuning constants.
- You conclude the two components should be merged into one. They should not —
  that is out of scope by design. Report the reasoning instead.
- Removing a "duplicate" would require changing a tuning number to make the two
  agree. That number is art direction; stop and report.
- The built HTML loses a `<canvas>` element on either page.
- `git status --short` shows any file outside the three in scope.
- You find yourself editing `AGENTS.md`. Another plan owns that file right now.

## Maintenance note

After this lands, `src/lib/` exists and `AGENTS.md`'s structure list should gain
a line for it — that is a follow-up, deliberately not done here to avoid a
conflict with a concurrent docs plan. The compiler now enforces that both
components agree on the shared helper signatures, so a future change to
`readDotColors` surfaces at both call sites instead of drifting silently. What
this refactor deliberately does *not* protect: the tuning constants still live
in two places and still describe two different looks. That is intentional — the
homepage field and the 404 field are tuned differently on purpose. In review,
watch for anyone "finishing the job" by unifying those numbers.

## Git workflow

Commit your work in the worktree. Use Conventional Commits. Do **not** add
`Co-Authored-By`, "Generated with", or any AI attribution footer — the repo
owner's convention forbids them. Suggested message:

```
refactor(canvas): share the dot-field primitives between both fields

Substrate and DotMatrix each carried their own copy of the same hash
function, CSS-variable colour read, and DPR clamp, so tuning the signature
animation meant changing two files with nothing to catch a miss. The shared
primitives now live in src/lib/dot-field.ts. Rendering and tuning are
untouched — the two fields are still tuned differently on purpose.
```

Do not push. Do not merge. Your reviewer handles that.
