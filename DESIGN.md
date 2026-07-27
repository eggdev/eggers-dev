---
name: eggers.dev
description: Personal portfolio of a multi-disciplinary designer & engineer — confident, precise, fast.
---

# Design System: eggers.dev

## 1. Overview

**Creative North Star: "Deep Harbor at Dawn"**

Cold steel water, fog-muted light, the quiet before the boats leave. The system is built on a cool, near-monochrome base — ink on a calm surface — with a single cobalt accent that reads like a beacon cutting through fog, and one warm counter-accent reserved for the rare moment that should feel human. The mood is **confident, precise, considered**: a senior practitioner who lets the work carry the argument and trusts restraint to do the talking.

This is a portfolio whose primary visitor is a recruiter skimming fast, often on a phone, deciding whether to reach out. So the system optimizes for *speed of comprehension and credibility*: bold typographic hierarchy that orients in a glance, generous breathing room, and a palette quiet enough that the work — not the chrome — is what's loud. Both light and dark are first-class citizens; the surface follows the visitor's OS, and the cobalt accent holds its identity across both. The page itself is meant to read as a sample of the owner's work: its craft, performance, and finish are the proof.

It explicitly rejects: the **generic developer-portfolio template** (purple-gradient hero, skill bars, identical project cards), **SaaS marketing aesthetics** (hero-metric blocks, feature-icon grids, gradient buttons), **over-animated showcases** (scroll-jacking, parallax for its own sake), **clutter**, and the now-saturated **AI editorial-magazine cliché** (display-serif italic + tiny tracked mono eyebrows + ruled columns). Editorial *confidence* here comes from type weight and spatial composition, never from that fingerprint.

**Key Characteristics:**
- Near-monochrome base; color is rare and intentional, never decorative.
- Cool leads, warm punctuates: cobalt does the work, a warm accent is the exception.
- One sans family, hierarchy carried by dramatic weight and scale contrast.
- Flat and fast: depth through tonal layering and hairlines, not shadows.
- Minimal motion — clean transitions into content, never a hijacked scroll.
- System-adaptive: light and dark designed to the same standard.

## 2. Colors

A cool, restrained palette anchored on a single cobalt hue, with a warm counter-accent held in reserve. The base is near-monochrome with a faint cool tint pulled toward the cobalt; color appears only where it carries meaning.

Every value below is the token that ships in `src/styles/global.css`, which is the source of truth for color. Light is the `:root` default; dark is the `prefers-color-scheme: dark` override. Tokens that differ per theme are given as *light / dark*. The semantic tokens (`--accent`, `--cta`, `--focus`, `--dot-accent`) alias the raw families in light and are re-declared with their own values in dark, so a token can carry the same meaning at two different lightnesses.

### Primary
- **Cobalt / Harbor Blue** (`--cobalt` `oklch(0.55 0.12 238)`): The single brand voice. Links, focus rings, key highlights, active states, the rare accent rule. It ships at hue 238° — inside the ±10° band around the original 230° seed — and is carried across both themes by moving lightness while holding that hue.
  - `--cobalt-ink` `oklch(0.48 0.13 238)` — cobalt as *text* on the light surface, darkened until it clears 4.5:1. This is what `--accent` resolves to in light. The brighter `--cobalt` stays reserved for fills and focus rings, where the text threshold doesn't apply; that split is why two near-identical cobalts exist.
  - `--cobalt-strong` `oklch(0.42 0.14 240)` — hover/active for links.
  - Dark declares its own cobalts rather than aliasing the family: `--accent` `oklch(0.72 0.13 238)` (luminous cobalt on slate), `--accent-strong` `oklch(0.8 0.13 235)`, `--accent-bg` `oklch(0.62 0.14 238)`.
  - `--focus` is `--cobalt` in light and `oklch(0.78 0.13 238)` in dark. `--on-accent`, the text a cobalt fill carries, is `oklch(0.99 0.002 240)` / `oklch(0.16 0.01 245)`.

### Secondary
- **Warm Counter-accent** (`--warm` `oklch(0.66 0.16 47)`): The deliberate exception. Reserved for a single human moment — an availability pill, a hover surprise, a highlight that should feel warm against the cool. Never competes with cobalt for the same job. The family sits at hue ~45–60°.
  - `--warm-ink` `oklch(0.52 0.14 45)` — warm as *text* on light, darkened to clear 4.5:1, mirroring the cobalt fill/text split.
  - `--warm-tint` `oklch(0.95 0.03 60)` — the faint warm surface wash.
  - In light, `--cta` / `--cta-line` / `--cta-wash` alias `--warm-ink` / `--warm` / `--warm-tint`. In dark they take their own values: `oklch(0.8 0.13 52)` / `oklch(0.74 0.15 50)` / `oklch(0.27 0.04 50)`.

### Neutral
- **Ink** (`--ink` `oklch(0.24 0.022 250)` / `oklch(0.93 0.007 245)`): Body and heading text. Clears 7:1 against its surface in both themes, and carries a trace of the cobalt hue at very low chroma rather than reading as pure grey.
- **Muted** (`--muted` `oklch(0.455 0.022 248)` / `oklch(0.71 0.015 245)`): Secondary text, metadata, captions. Ink pulled toward the surface, still clearing 4.5:1 at body sizes.
- **Surface** (`--surface` `oklch(0.992 0.002 240)` / `oklch(0.195 0.012 245)`): Page background. Light is near-white with the faintest cool tint; dark is a deep cool slate — chroma stays at 0.012, so it reads cool without tipping into navy.
- **Raised surface / hairline**: Section and card separation via a tonal step plus 1px hairline borders, never shadows. `--surface-raised` `oklch(0.975 0.004 240)` / `oklch(0.235 0.014 245)`; `--hairline` `oklch(0.9 0.007 240)` / `oklch(0.32 0.016 245)`; `--hairline-strong` `oklch(0.84 0.009 240)` / `oklch(0.4 0.02 245)`.
- **Dot matrix** (`--dot` `oklch(0.55 0.04 240)` / `oklch(0.62 0.03 245)`): The base ink the background canvas fields draw with. Its companion `--dot-accent` is `--cobalt` in light and `oklch(0.72 0.13 238)` in dark, so the field picks up the brand hue without the chrome competing with content.

### Named Rules
**The One Voice Rule.** Cobalt appears on ≤10% of any given screen. Its rarity is the point; the moment it's everywhere it stops meaning anything.

**The Two-Temperature Rule.** Cool leads, warm punctuates. The warm counter-accent is an exception, never a system. If it shows up more than once or twice per view, it's overused — pull it back.

**The No-Navy-Default Rule.** Dark theme is a cool slate tuned from the cobalt hue, never the off-the-shelf dev-portfolio navy. Cool ≠ navy.

## 3. Typography

**Display Font:** Single sans family `[to be chosen at implementation]` — a confident, well-tuned grotesque/neo-grotesque with a wide weight range and tight, even spacing at large sizes.
**Body Font:** Same family.
**Label/Mono Font:** Same family (a mono is *not* part of this system; technical signal comes from precision, not costume).

**Character:** One voice, many weights. The whole hierarchy is built from a single sans, and all of its drama comes from weight and scale contrast — heavy, large display against light, quiet body. Distinctive and refined, never the AI-default sans (no Inter / DM Sans / Space Grotesk reflexes), never a competing second family.

### Hierarchy
- **Display** (heavy weight, fluid `clamp()` max ≤ ~6rem, line-height ~1, letter-spacing ≥ -0.04em): Hero name / statement. `text-wrap: balance`.
- **Headline** (semibold–bold, large): Section titles, project names.
- **Title** (medium–semibold): Sub-headings, project roles.
- **Body** (regular, comfortable line-height, max 65–75ch): Reading copy, project descriptions. `text-wrap: pretty` on long prose.
- **Label** (medium, small, slight positive tracking; sentence case or short caps for ≤4-word labels only): Metadata, tags, dates, nav.

### Named Rules
**The One Family Rule.** A single sans does everything. Hierarchy is weight and scale, not a second typeface. At least a 1.25 ratio between scale steps — flat scales read as uncommitted.

**The No-Reflex-Sans Rule.** Inter, DM Sans, Space Grotesk, Plus Jakarta and the other training-data defaults are forbidden. The family is chosen for voice, from a real catalog, at build time.

## 4. Elevation

Flat by default. Motion and depth are deliberately quiet, so the system conveys structure through **tonal layering and hairline (1px) borders**, not drop shadows. A raised surface is a small step in lightness plus a hairline, not a floating card with a blurred shadow. Shadows, if they ever appear, are a response to state (a subtle lift on hover for an interactive element), never ambient decoration at rest.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Any elevation is a response to interaction (hover, focus), never a permanent visual style. No glassmorphism, no ambient drop shadows under static cards.

## 5. Components

The site is built and live at https://eggers.dev, so the primitives below describe what ships. Text links are cobalt with a precise underline and focus treatment. Buttons come in two forms — primary (`.btn--primary`, an ink fill carrying surface-colored text) and ghost (`.btn--ghost`, a hairline border that picks up the accent on hover) — and both stay flat at rest. Navigation is weight-driven, with the active state carried by color. Work entries are the signature component: flat, hairline-separated, type-led, *not* an identical-card grid. The contact affordance stays reachable within a glance from anywhere on the page.

The components live in `src/components/`:

- `Rail.astro` — the persistent navigation rail: wordmark, the four section links (Work, How I work, About, Contact), and social links. Carries the scroll-driven active state.
- `Hero.astro` — the opening claim, set in the largest type on the page.
- `Work.astro` — the `#work` section; the hairline-separated, type-led work list.
- `HowIWork.astro` — the `#ai` section, which explains the method and embeds the diagram below.
- `NightShift.astro` — a canvas diagram of the harness drawn as the loop it actually runs.
- `About.astro` — the `#about` section; a short prose column, no timeline or skill-bar widgetry.
- `Contact.astro` — the `#contact` section; the email call-to-action, a copy-to-clipboard button, and the social handles.
- `Footer.astro` — the closing hairline, copyright, and back-to-top link.
- `Substrate.astro` — the fixed, full-bleed canvas dot-field the home page sits inside.
- `DotMatrix.astro` — the standalone dot-field, used as the visual on the 404 page.

`Builds.astro` (a "Side builds" section) also exists, but no page imports it and it is currently unrendered.

## 6. Do's and Don'ts

### Do:
- **Do** keep cobalt to ≤10% of any screen (The One Voice Rule); let its rarity carry the meaning.
- **Do** build the entire type hierarchy from one sans, differentiated by weight and scale (≥1.25 ratio between steps).
- **Do** design light and dark to the same standard; follow the visitor's OS preference.
- **Do** hold body text to ≥4.5:1 contrast (≥3:1 large), placeholders included, in *both* themes. WCAG 2.1 AA is the floor.
- **Do** keep motion to clean, fast transitions into content; every animation ships a `prefers-reduced-motion` fallback.
- **Do** convey depth with tonal steps and 1px hairlines; reserve any shadow for interaction states.
- **Do** make the work the loudest thing on the page; the chrome stays quiet.

### Don't:
- **Don't** ship the generic developer-portfolio template — no purple-gradient hero, no "Hi, I'm a passionate developer," no skill-percentage bars, no wall of identical project cards.
- **Don't** drift into SaaS marketing aesthetics — no hero-metric blocks, no feature-icon grids, no gradient buttons, no stock-illustration filler.
- **Don't** over-animate — no scroll-jacking, no parallax for its own sake, no heavy WebGL, nothing that fights native scroll.
- **Don't** clutter — no competing elements, no missing hierarchy, no airless layouts.
- **Don't** fall into the AI editorial-magazine cliché — no display-serif italic + tiny tracked mono eyebrows + ruled three-column separators + monochrome-by-reflex.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe; no gradient text; no glassmorphism as default.
- **Don't** default the dark theme to off-the-shelf dev-portfolio navy, or reach for a reflex sans (Inter / DM Sans / Space Grotesk).
- **Don't** let the warm counter-accent become a system; it punctuates, it doesn't lead.
