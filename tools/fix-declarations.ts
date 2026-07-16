import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const declarationSpecifier =
  /(from\s+|import\s*\()(['"])(\.{1,2}\/[^'".]+(?:\/[^'".]+)*)(\2)/g

const visit = (root: string): void => {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) {
      visit(path)
      continue
    }
    if (!path.endsWith('.d.ts')) continue

    const source = readFileSync(path, 'utf8')
    const rewritten = source.replace(
      declarationSpecifier,
      (_match, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}${specifier}.js${quote}`
    )
    if (rewritten !== source) writeFileSync(path, rewritten)
  }
}

const output = process.argv[2]
if (output === undefined)
  throw new Error('Expected a declaration output directory')
visit(output)
