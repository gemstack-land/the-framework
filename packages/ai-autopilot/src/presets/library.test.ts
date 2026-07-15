import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { vikePreset, nextPreset, builtinPresets, PresetRegistry, builtinPresetRegistry } from './library.js'

describe('built-in presets', () => {
  it('ship Vike (flagship) and Next, each a pure detector', () => {
    assert.deepEqual(builtinPresets().map(p => p.name), ['vike', 'next'])
    assert.equal(vikePreset.framework, 'Vike')
    assert.equal(nextPreset.framework, 'Next.js')
    assert.ok(vikePreset.signals.dependencies?.includes('vike'))
    assert.ok(nextPreset.signals.dependencies?.includes('next'))
  })
})

describe('PresetRegistry', () => {
  it('selects the detected preset', () => {
    const { preset, detection } = builtinPresetRegistry().select({ dependencies: ['next'] })
    assert.equal(preset.name, 'next')
    assert.equal(detection.framework, 'Next.js')
  })

  it('falls back to the flagship (first-registered) preset when nothing matches', () => {
    const { preset, detection } = builtinPresetRegistry().select({ dependencies: ['express'] })
    assert.equal(preset.name, 'vike') // flagship default
    assert.equal(detection.preset, undefined) // ...but detection is honest that nothing matched
  })

  it('honors an explicit fallback', () => {
    const { preset } = builtinPresetRegistry().select({ files: [] }, nextPreset)
    assert.equal(preset.name, 'next')
  })

  it('get / all / add', () => {
    const reg = new PresetRegistry([vikePreset])
    assert.equal(reg.get('vike')?.name, 'vike')
    assert.equal(reg.get('next'), undefined)
    reg.add(nextPreset)
    assert.deepEqual(reg.all().map(p => p.name), ['vike', 'next'])
  })
})
