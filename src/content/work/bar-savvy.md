---
title: Bar Savvy
org: Bar Savvy
role: Technical Co-Founder & CTO
period: 2023 to present
order: 1
outcome: Built a Texas alcohol-sales analytics platform end to end as the sole continuous engineer over three years, and ran it as an AI-native engineering operation.
stack:
  - Bun
  - Turborepo
  - Next.js
  - Expo / React Native
  - Supabase
  - Apache Airflow
  - Kubernetes
  - Stripe
metrics:
  - { value: '4,482', label: 'commits, sole continuous author', source: 'verified' }
  - { value: '25', label: 'production LLM modules in the data engine', source: 'verified' }
  - { value: '5-7×', label: 'shipping velocity as the harness matured', source: 'reported' }
caseStudy:
  - 'A Bun + Turborepo monorepo: four apps (web plus API, marketing, Expo native) and 29 shared @repo/* packages covering design system, auth, search, maps, payments, and data.'
  - 'The data engine is an Apache Airflow ETL containerized to AWS ECR, with numbered chained DAGs and dynamic task mapping, fusing TABC, Google, reviews, and dual geocoding into one canonical venue record.'
  - 'Cost-aware LLM use: cheap deterministic classifiers gate 25 production LLM modules for classification and fuzzy address matching, including a double-check reviewer that flags its own disagreements for a human to settle.'
  - 'Stood up the production backend on Kubernetes solo, then made the pragmatic call to drop a high-maintenance Elasticsearch API for direct SQL, cutting ops burden while improving latency.'
  - 'The AI-native system: a custom harness with AST lint rules and an auto-ratcheting merge policy, hooks that block unsafe agent actions, a nightly cleanup-and-merge loop, and cross-model Claude plus Codex review.'
  - 'The arc over 2026: planning fluent by February, the harness hardened against itself by April, mature gates by May, pointed at production by June.'
---

Bar Savvy turns Texas Alcoholic Beverage Commission data into analytics that help operators and investors find their best opportunities. I built it essentially end to end as the sole continuous engineer over three years, owning every surface from the web and native apps to the Airflow data engine, the Kubernetes backend, and the AI-native harness that ships it. Early-stage by design, so the signal is craft, full-stack ownership, and AI-native practice run lean.
