import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectFramework } from './detect.js'
import { vikePreset, nextPreset, builtinPresets } from './library.js'

const presets = builtinPresets()

describe('detectFramework', () => {
  it('detects Vike from its dependency', () => {
    const d = detectFramework(presets, { dependencies: { 'vike-react': '1.0.0', react: '18' } })
    assert.equal(d.preset?.name, 'vike')
    assert.equal(d.framework, 'Vike')
    assert.ok(d.confidence >= 2)
    assert.match(d.scores[0]!.reasons.join(), /vike-react/)
  })

  it('detects Next from a dep + a file, and outscores a bare dep match', () => {
    const d = detectFramework(presets, {
      dependencies: ['next'],
      files: ['app/dashboard/page.tsx', 'next.config.mjs'],
    })
    assert.equal(d.preset?.name, 'next')
    // dep (2) + two file patterns (1 each) = 4
    assert.ok(d.confidence >= 3)
  })

  it('accepts dependencies as a bare list of names', () => {
    const d = detectFramework(presets, { dependencies: ['vike'] })
    assert.equal(d.preset?.name, 'vike')
  })

  it('returns no preset and confidence 0 when nothing matches', () => {
    const d = detectFramework(presets, { dependencies: ['express'], files: ['server.js'] })
    assert.equal(d.preset, undefined)
    assert.equal(d.framework, undefined)
    assert.equal(d.confidence, 0)
    assert.equal(d.scores.length, presets.length) // every preset still scored (at 0)
  })

  it('picks the higher-scoring framework when signals overlap', () => {
    // a repo mid-migration: has next as a dep but many Vike files
    const d = detectFramework(presets, {
      dependencies: ['next', 'vike'],
      files: ['pages/index/+Page.tsx', '+config.ts'],
    })
    // vike: dep(2) + 2 files(2) = 4 ; next: dep(2) = 2
    assert.equal(d.preset?.name, 'vike')
    assert.equal(d.scores[0]?.preset, 'vike')
    assert.equal(d.scores[1]?.preset, 'next')
  })

  it('weights a dependency above a file match', () => {
    const depOnly = detectFramework([nextPreset], { dependencies: ['next'] }).confidence
    const fileOnly = detectFramework([vikePreset], { files: ['x/+config.ts'] }).confidence
    assert.ok(depOnly > fileOnly)
  })
})
