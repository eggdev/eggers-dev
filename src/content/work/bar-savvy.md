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
  - { value: '~77%', label: 'of commits over three years, sole author', source: 'verified' }
  - { value: '25', label: 'production LLM modules in the data engine', source: 'verified' }
  - { value: '2,976', label: 'commits co-authored with AI', source: 'verified' }
caseStudy:
  - 'Built it as a Bun + Turborepo monorepo: four apps (web plus API, marketing, Expo native) over 29 shared @repo/* packages covering design system, auth, search, maps, payments, and data.'
  - 'The data engine is an Apache Airflow ETL containerized to AWS ECR, with numbered chained DAGs and dynamic task mapping, fusing TABC, Google, reviews, and dual geocoding into one canonical venue record.'
  - 'Gated 25 production LLM modules behind cheap deterministic classifiers for classification and fuzzy address matching, including a double-check reviewer that flags its own disagreements for a human to settle.'
  - 'Stood up the production backend on Kubernetes solo, then dropped a high-maintenance Elasticsearch API for direct SQL, which cut the ops burden and improved latency.'
  - 'Wrote the harness itself: AST lint rules, an auto-ratcheting merge policy, hooks that block unsafe agent actions, a nightly cleanup-and-merge loop, and cross-model Claude plus Codex review.'
  - 'Planning got fluent in February 2026. By April the harness was hardened against itself, by May the merge gates were mature, and in June I pointed the whole thing at production.'
---

Bar Savvy turns Texas Alcoholic Beverage Commission data into analytics that help operators and investors find their best opportunities. Being the only engineer meant owning every surface: the web and native apps, the Airflow data engine, the Kubernetes backend, and the harness that ships it all. The company is still early-stage, so judge this one on craft, breadth, and how lean it runs.
