const sourcePatterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.astro']
const roots = ['apps', 'packages', 'tools', 'e2e']
const rootPatterns = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs']
const importPattern = /(?:from\s*|import\s*\(|import\s*)['"](\.{1,2}\/[^'"]*)['"]/g
const violations: string[] = []
const files = new Set<string>()

const inspect = async (file: string) => {
  if (
    file.endsWith('worker-configuration.d.ts') ||
    file.includes('/dist/') ||
    file.includes('/.astro/') ||
    file.includes('/.wrangler/') ||
    file.includes('/node_modules/')
  ) {
    return
  }
  const source = await Bun.file(file).text()
  for (const match of source.matchAll(importPattern)) {
    violations.push(`${file}: relative import ${match[1]}`)
  }
}

for (const root of roots) {
  for (const pattern of sourcePatterns) {
    const glob = new Bun.Glob(`${root}/${pattern}`)
    for (const file of glob.scanSync({ cwd: '.', onlyFiles: true })) {
      files.add(file)
    }
  }
}

for (const pattern of rootPatterns) {
  const glob = new Bun.Glob(pattern)
  for (const file of glob.scanSync({ cwd: '.', onlyFiles: true })) {
    files.add(file)
  }
}

await Promise.all([...files].map(inspect))

if (violations.length > 0) {
  console.error(['Local imports must use workspace path aliases:', ...violations].join('\n'))
  process.exit(1)
}

console.log('All local source imports use workspace aliases.')
