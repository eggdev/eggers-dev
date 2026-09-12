import resumeSource from '@career/public-resume.json'
import { validateResume } from '@career/schema'

export interface SeedDocument {
  id: string
  title: string
  kind: 'inbox' | 'note'
  visibility: 'private' | 'shareable' | 'public'
  tags: string[]
  bodyMarkdown: string
}

export const seededResume = (() => {
  const result = validateResume(resumeSource)
  if (!result.data || result.errors.length > 0) {
    throw new Error(`Invalid bundled resume seed: ${result.errors.join(', ')}`)
  }
  return result.data
})()

export const seedDocuments: SeedDocument[] = [
  {
    id: 'inbox-welcome',
    title: 'Start here',
    kind: 'inbox',
    visibility: 'private',
    tags: ['inbox'],
    bodyMarkdown:
      '# Career inbox\n\nDrop rough notes here without organizing them first. Markdown shortcuts work as you type, and the toolbar keeps common formatting close. Promote useful material into a note when it earns structure.\n\nNothing in the Inbox can be published directly.',
  },
  {
    id: 'note-bar-savvy',
    title: 'Bar Savvy',
    kind: 'note',
    visibility: 'private',
    tags: ['venture', 'data', 'ai', 'platform'],
    bodyMarkdown:
      '# Bar Savvy\n\nBuilt a Texas alcohol-sales analytics platform end to end as the sole continuous engineer over three years, and ran it as an AI-native engineering operation.\n\n- Built four apps over 29 shared packages: web, API, marketing, and Expo native.\n- Built the Apache Airflow data engine that fuses TABC filings, Google data, reviews, and dual geocoding.\n- Gated production LLM modules behind deterministic classifiers and a second-pass reviewer.\n- Replaced a high-maintenance Elasticsearch API with direct SQL.\n- Built AST lint rules, guardrail hooks, and an auto-ratcheting merge policy for the agent harness.\n\n**Source:** imported from the existing résumé and public work entry.',
  },
  {
    id: 'note-lv-collective',
    title: 'LV Collective',
    kind: 'note',
    visibility: 'private',
    tags: ['leadership', 'ai', 'product'],
    bodyMarkdown:
      '# LV Collective\n\nLed Sidekick OS, an executive-knowledge product, to a working product in a four-week sprint and shipped upcredit across the student-housing portfolio.\n\n- Built Sidekick OS on an Nx monorepo with Effect, Zero local-first sync, and WorkOS.\n- Designed client-side per-user encryption with a DEK/KEK AES-256-GCM scheme.\n- Shipped upcredit as a deliberately small Next.js, Clerk, and Supabase product.\n- Developed office hours and lessons into an AI Builders Committee.\n\n**Source:** imported from the existing résumé and public work entry.',
  },
  {
    id: 'note-nba',
    title: 'NBA, Direct-to-Consumer',
    kind: 'note',
    visibility: 'private',
    tags: ['product', 'platform', 'identity'],
    bodyMarkdown:
      '# NBA, Direct-to-Consumer\n\nBuilt the live-scores surface and led client-side identity, entitlements, and subscriptions across web and connected devices.\n\n- Built NBA.com’s score strip from its first commit and remained its primary owner.\n- Led TV Everywhere, international broadcaster, and CIAM integration in a reusable React auth library.\n- Tech-led the League Pass purchase page and recursive content-block renderer.\n- Helped launch Local Access streaming and built the Nike 2024 All-Star sign-up flow.\n- Built the self-service repository provisioning tool adopted by the DTC organization.\n\n**Source:** imported from the existing résumé and public work entry.',
  },
]
