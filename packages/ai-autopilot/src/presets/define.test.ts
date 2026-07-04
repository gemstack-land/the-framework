import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { definePreset, PresetError } from './define.js'
import { defineSkill } from '../extensions/define.js'

describe('definePreset', () => {
  it('validates and freezes a preset, defaulting personas/signals', () => {
    const preset = definePreset({ name: 'astro', framework: 'Astro' })
    assert.equal(preset.name, 'astro')
    assert.equal(preset.framework, 'Astro')
    assert.deepEqual(preset.personas, [])
    assert.deepEqual(preset.signals.dependencies, [])
    assert.equal(preset.skill, undefined) // no framework skill unless supplied
    assert.throws(() => {
      ;(preset as { name: string }).name = 'x'
    })
  })

  it('carries the framework skill it points at', () => {
    const skill = defineSkill({ name: 'astro', title: 'Astro', description: 'd', url: 'https://astro.build/llms.txt' })
    const preset = definePreset({ name: 'astro', framework: 'Astro', skill })
    assert.equal(preset.skill, skill)
  })

  it('rejects a missing/non-kebab name and a missing framework', () => {
    assert.throws(() => definePreset({ name: '', framework: 'X' }), PresetError)
    assert.throws(() => definePreset({ name: 'Not Kebab', framework: 'X' }), /kebab-case/)
    assert.throws(() => definePreset({ name: 'ok', framework: '' }), /needs a framework/)
  })
})
