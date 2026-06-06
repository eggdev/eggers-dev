import { defineCollection } from 'astro:content'
import { z } from 'astro:schema'
import { glob } from 'astro/loaders'

/**
 * `work` — the selected-work entries. Each is outcome-first: the frontmatter
 * `outcome` is the lead line, the Markdown body is the "how". Metrics lead with
 * git-verified numbers; self-reported figures carry a `note`.
 */
const work = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/work' }),
  schema: z.object({
    title: z.string(),
    org: z.string(),
    role: z.string(),
    period: z.string(),
    order: z.number(),
    outcome: z.string(),
    stack: z.array(z.string()),
    metrics: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
          /** "verified" renders plain; "reported" gets a subtle self-reported mark */
          source: z.enum(['verified', 'reported']).default('verified'),
        })
      )
      .default([]),
    links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
  }),
})

export const collections = { work }
