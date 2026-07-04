import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discoverExtensions, readProjectSignals } from './extensions.js'

function workspace(pkg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'framework-ext-'))
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  return dir
}

test('readProjectSignals unions dependencies and devDependencies', () => {
  const dir = workspace({ dependencies: { 'vike-auth': '1.0.0' }, devDependencies: { vike: '0.4.0' } })
  const signals = readProjectSignals(dir)
  const deps = signals.dependencies as Record<string, string>
  assert.ok('vike-auth' in deps)
  assert.ok('vike' in deps)
})

test('readProjectSignals returns empty signals when there is no package.json', () => {
  const dir = workspace(undefined)
  assert.deepEqual(readProjectSignals(dir), {})
})

test('discoverExtensions finds nothing when no framework-* packages are declared', async () => {
  const dir = workspace({ dependencies: { vike: '0.4.0', react: '18.0.0' } })
  const result = await discoverExtensions(dir)
  assert.deepEqual(result.extensions, [])
  assert.deepEqual(result.failed, [])
})

test('discoverExtensions reports a declared-but-uninstalled framework-* package instead of throwing', async () => {
  const dir = workspace({ dependencies: { 'framework-ghost': '1.0.0' } })
  const result = await discoverExtensions(dir)
  assert.deepEqual(result.extensions, [])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]!.package, 'framework-ghost')
})
