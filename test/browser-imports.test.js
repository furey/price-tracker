import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IMPORT_PATTERN = /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g

test('modules reachable from the dashboard never import node built-ins', () => {
  const offenders = nodeImports(resolve(ROOT, 'web/src/main.js'))
  assert.deepEqual(offenders, [])
})

const nodeImports = (entry) => {
  const seen = new Set()
  const offenders = []
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)) {
      if (specifier.startsWith('node:')) offenders.push(`${relative(ROOT, file)}: ${specifier}`)
      const target = resolve(dirname(file), specifier)
      if (specifier.startsWith('.') && existsSync(target)) visit(target)
    }
  }
  visit(entry)
  return offenders
}
