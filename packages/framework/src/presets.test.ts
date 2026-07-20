import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { PRESETS, PRESET_DIR, presetFilePath, presetContext, materializePresets } from './presets.js'
import type { StoreFs } from './store/index.js'

test('PRESETS carries the quality presets, keyed by file stem (#326/#881)', () => {
  assert.deepEqual(
    Object.keys(PRESETS).sort(),
    ['maintainability', 'maintenance', 'readability', 'research', 'security_audit', 'ux'],
  )
  // `maintenance` (#881) is in the registry, not just exported: it materializes like the rest, so
  // a scheduled entry (#882) can point at `.the-framework/presets/maintenance.md` by path.
  // Underscore stem, not the hyphenated SECURITY_AUDIT_PRESET_NAME: matches the tf.presets key
  // Rom's #326 OP reads (`tf.presets.security_audit.filePath`).
  assert.ok('security_audit' in PRESETS)
})

test('presetFilePath is the workspace-relative .the-framework path', () => {
  assert.equal(PRESET_DIR, '.the-framework/presets')
  assert.equal(presetFilePath('maintainability'), '.the-framework/presets/maintainability.md')
})

test('presetContext maps every preset to its filePath', () => {
  const ctx = presetContext()
  assert.deepEqual(Object.keys(ctx).sort(), Object.keys(PRESETS).sort())
  assert.equal(ctx.security_audit!.filePath, '.the-framework/presets/security_audit.md')
})

test('materializePresets writes every preset verbatim under the repo (#326)', async () => {
  const written = new Map<string, string>()
  const dirs: string[] = []
  const fs: StoreFs = {
    async read() { return '' },
    async write(path, contents) { written.set(path, contents) },
    async append() {},
    async exists(path) { return written.has(path) },
    async mkdir(path) { dirs.push(path) },
    async readdir() { return [] },
  }
  await materializePresets('/repo', fs)
  assert.ok(dirs.includes(join('/repo', PRESET_DIR)), 'creates the presets dir')
  for (const [name, text] of Object.entries(PRESETS)) {
    assert.equal(written.get(join('/repo', PRESET_DIR, `${name}.md`)), text, `missing ${name}`)
  }
  // The blank ships unrendered: the TODO entry tells the agent what to set tf.params.what to.
  assert.ok(written.get(join('/repo', PRESET_DIR, 'maintainability.md'))?.includes('${{ tf.params.what }}'))
})
