import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectMaterialChange } from './material.js'

describe('detectMaterialChange', () => {
  it('flags a build/config change', () => {
    const v = detectMaterialChange({ kind: 'major-change', paths: ['src/foo.ts', 'package.json'] })
    assert.equal(v.material, true)
    assert.match(v.reasons.join(), /build\/config change \(package\.json\)/)
  })

  it('flags a test-framework migration', () => {
    const v = detectMaterialChange({ kind: 'major-change', paths: ['vitest.config.ts'] })
    assert.equal(v.material, true)
    assert.match(v.reasons.join(), /test-tooling change/)
  })

  it('flags a large change spread across several areas', () => {
    const paths = ['a/1.ts', 'a/2.ts', 'b/3.ts', 'b/4.ts', 'c/5.ts', 'c/6.ts', 'd/7.ts', 'd/8.ts']
    const v = detectMaterialChange({ kind: 'major-change', paths })
    assert.equal(v.material, true)
    assert.match(v.reasons.join(), /large change across 8 files in 4 areas/)
  })

  it('does not flag a big change confined to one area', () => {
    const paths = Array.from({ length: 10 }, (_, i) => `src/feature/${i}.ts`)
    const v = detectMaterialChange({ kind: 'major-change', paths })
    assert.equal(v.material, false)
  })

  it('flags a restructure described in the summary even without telltale paths', () => {
    const v = detectMaterialChange({ kind: 'major-change', summary: 'Renamed and moved the auth module', paths: ['src/auth/index.ts'] })
    assert.equal(v.material, true)
    assert.match(v.reasons.join(), /restructure described/)
  })

  it('skips a routine edit', () => {
    const v = detectMaterialChange({ kind: 'major-change', summary: 'fix a typo', paths: ['src/util.ts'] })
    assert.deepEqual(v, { material: false, reasons: [] })
  })

  it('honors a custom threshold and extra patterns', () => {
    assert.equal(detectMaterialChange({ kind: 'x', paths: ['a/1.ts', 'b/2.ts'] }, { manyFilesThreshold: 2 }).material, true)
    const extra = detectMaterialChange({ kind: 'x', paths: ['infra/deploy.tf'] }, { extraPatterns: [/\.tf$/] })
    assert.equal(extra.material, true)
    assert.match(extra.reasons.join(), /watched path changed/)
  })
})
