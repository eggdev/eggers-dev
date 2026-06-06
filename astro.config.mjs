// @ts-check
import { defineConfig } from 'astro/config'

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://eggers.dev',
  output: 'static',

  markdown: {
    // Dual-theme syntax highlighting for the harness excerpts; toggled by
    // prefers-color-scheme in global.css (see .astro-code styles).
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      wrap: false,
    },
  },

  devToolbar: { enabled: false },
  adapter: cloudflare(),
})