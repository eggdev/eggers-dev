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
    // deeper, verified proof revealed in a "Read the full story" disclosure
    caseStudy: z.array(z.string()).default([]),
  }),
})

/**
 * `blog` — the build log. Posts are markdown; `pubDate` is the honest publish
 * date (retrospectives say "earlier this year" in the body, never in a
 * backdated stamp). Set `draft: true` to stage a post without publishing it.
 */
const blog = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
})

export const collections = { work, blog }
