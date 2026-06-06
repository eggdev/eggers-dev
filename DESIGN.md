<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
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

*Seed mode: final OKLCH values are resolved at implementation. The anchor and hue families below are committed; exact lightness/chroma per theme are tuned against live contrast.*

### Primary
- **Cobalt / Harbor Blue** (anchor `oklch(0.55 0.105 230)`; exact value `[to be resolved during implementation]`): The single brand voice. Links, focus rings, key highlights, active states, the rare accent rule. Carried across both light and dark by adjusting lightness, holding the hue near 230°.

### Secondary
- **Warm Counter-accent** (hue family ~40–55°, amber/coral; `[to be resolved during implementation]`): The deliberate exception. Reserved for a single human moment — an availability pill, a hover surprise, a highlight that should feel warm against the cool. Never competes with cobalt for the same job.

### Neutral
- **Ink** (`[to be resolved]`): Body and heading text. Must reach ≥7:1 against its surface; may carry a trace of the cobalt hue at very low chroma rather than pure grey.
- **Muted** (`[to be resolved]`): Secondary text, metadata, captions. Ink pulled toward the surface; must still clear ≥4.5:1 for body sizes.
- **Surface** (`[to be resolved]`): Page background. Light theme leans toward pure/near-pure with the faintest cool tint; dark theme is a deep cool slate (cool, not black, not navy-cliché).
- **Raised surface / hairline** (`[to be resolved]`): Section and card separation via tonal step + 1px hairline borders, not shadows.

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

*Seed mode: no components exist yet. The next `/impeccable document` run (scan mode, after the first build) will extract real component tokens and generate the `.impeccable/design.json` sidecar.*

Canonical primitives to define at build time, consistent with the rules above: text links (cobalt, with a precise underline/focus treatment), primary & ghost buttons (flat, hairline or filled-cobalt, white text on the cobalt fill), navigation (weight-driven, active-state by color), project / work entries (the signature component — flat, hairline-separated, type-led, *not* an identical-card grid), and the contact affordance (must be reachable within a glance from anywhere).

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
