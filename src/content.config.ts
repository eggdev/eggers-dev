import { defineCollection } from 'astro:content'
import { z } from 'astro:schema'
import { glob } from 'astro/loaders'

/**
 * `work` — the selected-work entries. Each is outcome-first: the frontmatter
 * `outcome` is the lead line, the Markdown body is the "how".
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
        })
      )
      .default([]),
    links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
    // deeper implementation detail revealed in a "Read the full story" disclosure
    caseStudy: z.array(z.string()).default([]),
  }),
})

export const collections = { work }
