import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  vikePreset,
  nextPreset,
  builtinPresets,
  presetPersonas,
  PresetRegistry,
  builtinPresetRegistry,
} from './library.js'

describe('built-in presets', () => {
  it('ship Vike (flagship) and Next, each pointing at its framework skill', () => {
    assert.deepEqual(builtinPresets().map(p => p.name), ['vike', 'next'])
    // The page builder rides the framework skill, not the preset itself.
    assert.deepEqual(vikePreset.personas, [])
    assert.deepEqual(nextPreset.personas, [])
    assert.equal(vikePreset.skill?.name, 'vike')
    assert.equal(nextPreset.skill?.name, 'next')
    assert.equal(vikePreset.skill?.personas[0]?.name, 'vike-page-builder')
    assert.equal(nextPreset.skill?.personas[0]?.name, 'next-page-builder')
  })
})

describe('presetPersonas', () => {
  it('is the preset page builder followed by the shared neutral personas', () => {
    const names = presetPersonas(vikePreset).map(p => p.name)
    assert.deepEqual(names, ['vike-page-builder', 'data-modeler', 'ui-intent-designer'])
  })

  it('swaps only the page builder between frameworks — the rest of the stack is shared', () => {
    const vike = presetPersonas(vikePreset).map(p => p.name)
    const next = presetPersonas(nextPreset).map(p => p.name)
    assert.equal(vike[0], 'vike-page-builder')
    assert.equal(next[0], 'next-page-builder')
    assert.deepEqual(vike.slice(1), next.slice(1)) // identical shared core
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
