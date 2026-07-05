import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defineDomainPreset, DomainPresetError } from './define.js'
import { defineLoop } from '../loop/define.js'
import { defineSkill } from '../extensions/define.js'

const aLoop = defineLoop({ on: 'major-change', run: ['review'] })
const aSkill = defineSkill({ name: 'vike', title: 'Vike', description: 'Vike knowledge', url: 'https://vike.dev/llms.txt' })
const aPrompt = { id: 'review', name: 'review', title: 'Review', description: '', instructions: 'do', passes: 1, appliesTo: [] }

describe('defineDomainPreset', () => {
  it('freezes the bundle and defaults title/description/lists', () => {
    const preset = defineDomainPreset({ name: 'software-development' })
    assert.equal(preset.name, 'software-development')
    assert.equal(preset.title, 'software-development') // title defaults to name
    assert.equal(preset.description, '')
    assert.deepEqual(preset.loops, [])
    assert.deepEqual(preset.prompts, [])
    assert.deepEqual(preset.skills, [])
    assert.ok(Object.isFrozen(preset))
    assert.throws(() => ((preset as { name: string }).name = 'x'))
  })

  it('carries the three content types', () => {
    const preset = defineDomainPreset({
      name: 'sw-dev',
      title: 'Software Development',
      description: 'General engineering.',
      loops: [aLoop],
      prompts: [aPrompt],
      skills: [aSkill],
    })
    assert.equal(preset.title, 'Software Development')
    assert.deepEqual(preset.loops, [aLoop])
    assert.deepEqual(preset.prompts, [aPrompt])
    assert.deepEqual(preset.skills, [aSkill])
  })

  it('rejects a missing or non-kebab name', () => {
    assert.throws(() => defineDomainPreset({ name: '' }), DomainPresetError)
    assert.throws(() => defineDomainPreset({ name: 'Software Dev' }), DomainPresetError)
  })
})
