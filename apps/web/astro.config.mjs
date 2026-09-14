// @ts-check
import { fileURLToPath } from 'node:url'
import cloudflare from '@astrojs/cloudflare'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const webSource = fileURLToPath(new URL('./src/', import.meta.url))
const workspacePackages = fileURLToPath(new URL('../../packages/', import.meta.url))

export default defineConfig({
  site: 'https://eggers.dev',
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  session: false,
  publicDir: '../../public',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  vite: {
    resolve: {
      tsconfigPaths: true,
      alias: [
        { find: /^@web\/(.*)$/, replacement: `${webSource}$1` },
        {
          find: '@repo/content/resume-pdf',
          replacement: `${workspacePackages}content/src/resume-pdf.tsx`,
        },
        {
          find: '@repo/content/public-resume',
          replacement: `${workspacePackages}content/src/public-resume.json`,
        },
        { find: '@repo/content/resume', replacement: `${workspacePackages}content/src/resume.ts` },
        { find: '@repo/content/site', replacement: `${workspacePackages}content/src/site.ts` },
        { find: '@repo/content/seed', replacement: `${workspacePackages}content/src/seed.ts` },
        { find: '@repo/content', replacement: `${workspacePackages}content/src/index.ts` },
        { find: '@repo/cms', replacement: `${workspacePackages}cms/src/index.ts` },
        { find: '@repo/auth', replacement: `${workspacePackages}auth/src/index.ts` },
        { find: '@repo/worker', replacement: `${workspacePackages}worker/src/index.ts` },
        {
          find: '@repo/design/styles.css',
          replacement: `${workspacePackages}design/src/styles.css`,
        },
      ],
    },
    plugins: [tailwindcss()],
  },
  devToolbar: { enabled: false },
})
