import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defineFrameworkPreset, FrameworkPresetError } from './define.js'

describe('defineFrameworkPreset', () => {
  it('validates and freezes a preset, defaulting signals', () => {
    const preset = defineFrameworkPreset({ name: 'astro', framework: 'Astro' })
    assert.equal(preset.name, 'astro')
    assert.equal(preset.framework, 'Astro')
    assert.deepEqual(preset.signals.dependencies, [])
    assert.deepEqual(preset.signals.files, [])
    assert.throws(() => {
      ;(preset as { name: string }).name = 'x'
    })
  })

  it('rejects a missing/non-kebab name and a missing framework', () => {
    assert.throws(() => defineFrameworkPreset({ name: '', framework: 'X' }), FrameworkPresetError)
    assert.throws(() => defineFrameworkPreset({ name: 'Not Kebab', framework: 'X' }), /kebab-case/)
    assert.throws(() => defineFrameworkPreset({ name: 'ok', framework: '' }), /needs a framework/)
  })
})
