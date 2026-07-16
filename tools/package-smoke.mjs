import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

for (const packageName of readdirSync('packages')) {
  const root = resolve('packages', packageName)
  const manifestPath = resolve(root, 'package.json')
  if (!existsSync(manifestPath)) continue

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = resolve(root, manifest.main)
  const declarations = resolve(root, manifest.types)
  if (!existsSync(entry)) throw new Error(`${manifest.name} has no built entry`)
  if (!existsSync(declarations)) {
    throw new Error(`${manifest.name} has no declaration entry`)
  }
  const packed = spawnSync('bun', ['pm', 'pack', '--dry-run', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (packed.status !== 0) {
    throw new Error(`${manifest.name} failed to pack:\n${packed.stderr}`)
  }
  await import(pathToFileURL(entry))
}
