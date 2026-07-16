import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const sourceExtensionPattern =
  /(?:from\s+|import\s*\()\s*['"]\.{1,2}\/[^'"]+\.js['"]/g
const sourceFiles: Array<string> = []

const collectSourceFiles = (root: string): void => {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== 'dist' && entry !== 'node_modules') collectSourceFiles(path)
    } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
      sourceFiles.push(path)
    }
  }
}

collectSourceFiles('apps')
collectSourceFiles('packages')

const violations: Array<string> = []

for (const file of sourceFiles) {
  if (sourceExtensionPattern.test(readFileSync(file, 'utf8'))) {
    violations.push(`${file}: relative source imports must not end in .js`)
  }
  sourceExtensionPattern.lastIndex = 0
}

if (existsSync('examples')) {
  violations.push('examples/: examples belong under apps/')
}

for (const packageName of readdirSync('packages')) {
  const manifestPath = join('packages', packageName, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    readonly exports?: Record<string, { readonly bun?: string }>
  }
  if (manifest.exports?.['.']?.bun !== undefined) {
    violations.push(
      `${manifestPath}: published packages must not export source through the bun condition`
    )
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation)
  process.exitCode = 1
}
