---
title: Sidekick OS & upcredit
org: LV Collective
role: Director, Software Engineering
period: 2025 to present
order: 2
outcome: Led Sidekick OS, an executive-knowledge OS, to a working product in a four-week sprint, and shipped upcredit, a rent-credit product now live across LV Collective's portfolio.
stack:
  - Effect
  - Nx
  - Zero (local-first)
  - WorkOS
  - Next.js
  - Supabase
  - PostHog
metrics:
  - { value: '~70%', label: 'of commits in a four-week sprint', source: 'verified' }
  - { value: '50 min to 1 min', label: 'deploy time, via an autonomous fix', source: 'reported' }
  - { value: '$150K+/yr', label: 'value from upcredit, live across the portfolio', source: 'reported' }
caseStudy:
  - 'Sidekick OS runs on a pnpm + Nx monorepo (api, web, cli, worker) with Effect 3 as the runtime substrate, Zero local-first sync, and WorkOS auth.'
  - 'Per-user encryption: a DEK/KEK AES-256-GCM scheme encrypts knowledge at rest and decrypts client-side, so destroying a key crypto-shreds that user data, the unit of GDPR erasure.'
  - 'AI-native from day one: a custom invariant scanner with twelve zero-mode architecture rules (Node and Git only), a git-native AI issue tracker, and most Codex work running fully autonomous.'
  - 'An autonomous run root-caused a deploy split-brain, built a schema-drift gate, and cut deploy time from roughly 50 minutes to about one.'
  - 'upcredit: a deliberately small rent-reporting credit product (Next.js, Clerk, Supabase) running across LV Collective student-housing properties.'
---

Sidekick OS is a private executive-knowledge operating system: an AI assistant
over an executive's connected sources, an encrypted vault, inbox digests, and
chat. I led the build, writing about 70% of the commits in a four-week sprint on
an Effect and Nx monorepo with Zero local-first sync and WorkOS auth. It ships
real production engineering: per-user AES-256 at-rest encryption with client-side
decryption, so destroying a key crypto-shreds that user's data.

It was AI-native from day one. Most commits are Claude-coauthored, most Codex work
runs fully autonomous, and the repo enforces its own architecture through a custom
invariant scanner and a git-native AI issue tracker. One autonomous run root-caused
a deploy split-brain, built a schema-drift gate, and cut deploy time from roughly
50 minutes to about one.

upcredit is the counterweight: a deliberately small rent-reporting credit product
I built with a co-founder. It runs across all of LV Collective's student-housing
properties and generates over $150K a year in value with minimal upkeep. A
high-leverage build that pays for itself many times over.
