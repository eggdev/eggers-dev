# Improvement plans — eggers.dev

Written by `/improve` (quick audit) against commit `3435350`, 2026-07-27.

Each plan is self-contained: an executor with no context from the audit session
can run it start to finish. Plans are numbered in recommended execution order,
but see the dependency notes — most are independent.

## Status

| # | Plan | Category | Effort | Risk | Depends on | Status |
|---|---|---|---|---|---|---|
| 001 | [Make the docs describe the real repo](001-docs-truth-up.md) | docs | S | LOW | none | **DONE** — reviewed, approved. `2cc2488` on `worktree-agent-a16b1c153fb4fa05f` |
| 002 | [Delete the unrendered Builds.astro](002-remove-dead-builds-component.md) | tech-debt | S | LOW | none | **DONE** — reviewed, approved. `b0f2bff` on `worktree-agent-a98190e743d87b777` |
| 003 | [Patch Astro to 6.4.8](003-astro-security-patch.md) | security | S | LOW | none | **DONE** — approved with one criterion waived, see below. `8888abb` on `worktree-agent-ae35699b92b27e547` |
| 004 | [Share the dot-field primitives](004-dedupe-dot-field-primitives.md) | tech-debt | M | MED | none | **EXECUTED, RECOMMEND DISCARDING** — see below. `8270ae2` on `worktree-agent-a83defb92e32f91df` |
| 005 | [Fill in DESIGN.md §2's colour tokens](005-design-md-colors-section.md) | docs | S | LOW | 001 | TODO |
| 006 | [Upgrade to Astro 7](006-astro-7-upgrade.md) | migration/security | M | HIGH | 001–003 merged | **DONE, SHIPPED** — `ad10970`, live and verified (`Astro v7.1.4` in the generator meta) |

## Shipped

`main` is at `ad10970` and deployed. Live verification after the Astro 7 deploy:
generator `Astro v7.1.4`, hero copy present, harness snippet still
syntax-highlighted, 2 canvases, **0 external JS** (scripts still inlined), nav
correct, `/404` `/sitemap-index.xml` `/robots.txt` all 200.

`bun audit` reports **no astro advisory block at all** — all four that started
this (one HIGH SSRF, two moderate XSS, one low XSS) are gone, plus the HIGH
postcss advisory cleared for free when Astro 7 moved to Vite 8. Total went
19 → 15, and the remainder are transitive dev/build-time only (`sharp`,
`undici`, `ws`, `fast-uri`, `svgo`, `yaml`, `esbuild`, `js-yaml`).

`.nvmrc` pinning Node 24 was the load-bearing part: Astro 7 requires
`>=22.12.0` and the Cloudflare build had no pin. It worked — the deploy took
about 36 seconds and the generator meta flipped 6.4.8 → 7.1.4.

### Note for the next executor run

Agent worktrees branch from the **session's starting commit**, not from live
`main`. The first 006 run stopped at its drift check for exactly this reason,
and correctly diagnosed it as a stale base rather than an unmerged dependency.
Plan 006's Step 0 (`git fetch origin` + verify `main..HEAD` empty +
`git reset --hard origin/main`) is the fix and should be copied into any future
plan that depends on recently merged work.

## Plan 004 was a bad trade — my error, not the executor's

The executor did this correctly and thoroughly: net −9 lines across the two
components, hash equivalence verified across 40,000 cells, both pages checked in
a real headless browser with pixel counts and pointer-bloom deltas. It then
found and reported the thing that sinks the plan.

**Sharing a module forces Astro to stop inlining the scripts.** Verified
independently: on `main`, `dist/_astro/*.js` does not exist and every script is
inlined. On the 004 branch the build emits three files — `Substrate…js` (1.7K),
`DotMatrix…js` (2.3K), `dot-field…js` (353B) — and the HTML carries
`<script type="module" src="…">`. Every page now makes network requests before
the signature canvas can paint.

That trade is bad. `AGENTS.md` requires "static output, near-zero JS", and
`PRODUCT.md` makes speed a stated accessibility concern for a recruiter
skimming on a phone. Paying a round trip on every page load to deduplicate
roughly 20 shallow lines is the wrong side of that trade. The audit rated this
finding Med impact; it should have been Low, and the plan should never have been
written. Astro cannot share a module without externalising the script, so there
is no version of this refactor that keeps the inlining.

**Recommendation: discard the branch and keep the duplication.** If the drift
risk ever becomes real, the cheaper guard is a comment in each component
pointing at the other.

Two smaller notes from that run, both worth keeping:

- `src/components/NightShift.astro` is a third canvas component carrying its own
  `TAU` and DPR clamp. Left alone — and given the above, it should stay that way.
- The executor installed Chromium into the user's **global** playwright cache
  and symlinked `chromium_headless_shell-1208 → …-1234` to make browser
  verification possible. That is outside the repo and outside its worktree. The
  plans' scope sections govern repo files only and said nothing about the host
  environment; future plans should state that the machine outside the worktree
  is off-limits.

## Corrections to these plans, found during execution

Three done criteria were wrong as written. Recorded so the same mistakes don't
get re-made:

- **001, criterion 1** — asserted `grep -c "Seed mode" DESIGN.md` returns `0`.
  It returns `1`: a *second*, unrelated seed note lives in §2 Colors, which step
  1 never covered. The criterion should have been scoped to §5. The executor
  correctly refused to edit §2 rather than improvise outside its step, and
  surfaced it — which is where plan 005 came from.
- **002, criterion 3** — asserted a bare `grep -rn "Builds" src/` returns
  nothing. It matches `BaseLayout.astro:29`, where "Builds" is the English verb
  in a JSON-LD description string. Should have matched on the import specifier
  (`from '.*Builds.astro'`), not the bare word.
- **003, criterion 3** — asserted `bun audit` would show no astro block after
  the bump. Three of the five advisories were re-scoped to `astro >=2.9.0
  <=7.0.9` after the audit that produced this plan, so **no 6.x patch can clear
  them**. The HIGH (GHSA-2pvr-wf23-7pc7) and one moderate are gone; two moderate
  and one low remain and need Astro 7.1+. Waived, not failed.

## Dependencies and conflicts

All four are independent and can run in parallel, with one coordination note:

- **001 and 004 both want `AGENTS.md`.** 001 owns it. 004 is explicitly barred
  from touching it and instead reports that `src/lib/` needs adding to the
  structure list. Apply that one-line follow-up after both land.
- **001 and 002 interact loosely.** 001 asks the executor to note whether
  `Builds.astro` is unrendered; 002 deletes it. If 002 lands first, 001's
  component list should simply omit it. Neither blocks the other.

## Not planned, and why

Recorded so a future audit doesn't re-litigate these:

- **`.btn--ghost` in `global.css` reads as unused CSS** — rejected. `DESIGN.md`
  names "primary & ghost buttons" as canonical primitives; the token is
  intentional, not dead.
- **`.visually-hidden` in `global.css:238` is genuinely unreferenced** —
  not worth a plan. It is a standard accessibility utility costing ~40 bytes,
  and the next component that needs it will want it there.
- **No test suite** — real, but low leverage here. A static portfolio already
  gated by `astro check`, Biome, and a build that fails loudly gets little from
  unit tests. Revisit only if the site gains real interactive logic.
- **Astro 7.x** — a major upgrade, deliberately excluded from the 003 security
  patch. **Its status changed during execution**: it is no longer optional
  hygiene. Three XSS advisories (two moderate, one low) affect `astro >=2.9.0
  <=7.0.9`, so 6.4.8 — the newest 6.x — cannot clear them. Astro 7.1+ is the
  only fix. Worth its own migration plan; check whether `@astrojs/sitemap` and
  `@astrojs/check` need matching majors.
- **`postcss` / `sharp` / `undici` advisories** — transitive through
  `astro > vite` and `wrangler > miniflare`, build- and dev-time only, none
  reach visitors. They clear when the parents update; forcing resolutions would
  be worse than the exposure.

## Handled outside the plan system

**Six dead remote branches** survive from this repo's previous life as a
2020–21 Next.js + Django portfolio. Deleting a remote branch is irreversible
from the remote's side, so this is left for the owner to run by hand rather
than handed to an executor:

| Branch | Last commit | What it is |
|---|---|---|
| `origin/drf` | 2021-04-30 | Django REST portfolio, 48 commits |
| `origin/remix` | 2020-06-18 | Next.js portfolio, 47 commits |
| `origin/test-hook` | 2020-11-11 | Next.js job listing, 22 commits |
| `origin/semantic-release` | 2020-09-23 | release config, 20 commits |
| `origin/ssr` | 2020-06-18 | Vercel deploy config, 8 commits |
| `origin/cloudflare/workers-autoconfig` | 2026-06-06 | superseded Workers setup, 1 commit |

Record the SHAs first (`git rev-parse origin/<branch>`), then
`git push origin --delete <branch>`. The local `redesign/magazine-portfolio`
branch (18 unmerged commits) is a live decision, not cruft — keep or delete it
deliberately.

## Direction notes (not plans)

- **The resume is tracked but unreachable.** `resume/brendan-eggers-resume.{html,pdf}`
  is committed, linked from nothing in `src/`, and never copied into `dist/` —
  so it is published at no URL. `PRODUCT.md` names "how do I reach them?" as one
  of three questions a recruiter must answer in under a minute. Either move it
  to `public/` and link it from Contact, or drop it from the repo.
- **`redesign/magazine-portfolio` has 18 unmerged commits** — an alternative
  design direction someone already invested in. Worth reviving or deleting
  deliberately rather than leaving as a third option.
