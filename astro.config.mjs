// @ts-check
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  site: 'https://eggers.dev',
  output: 'static',
  integrations: [
    sitemap({
      // The 404 page is an error response, not a destination.
      filter: (page) => !page.includes('/404'),
    }),
  ],
  markdown: {
    // Dual-theme syntax highlighting for the harness excerpts; toggled by
    // prefers-color-scheme in global.css (see .astro-code styles).
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      wrap: false,
    },
  },
  devToolbar: { enabled: false },
})
