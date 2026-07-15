import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { composeDomainPresets, selectPreset } from './compose.js'
import { defineDomainPreset } from './define.js'
import { defineLoop } from '../loop/define.js'

const prompt = (id: string, instructions = id) => ({ id, name: id, title: id, description: '', instructions, passes: 1, appliesTo: [] })

const base = defineDomainPreset({
  name: 'base',
  loops: [defineLoop({ on: 'major-change', run: ['review'] })],
  prompts: [prompt('review', 'base-review'), prompt('security')],
})

const overlay = defineDomainPreset({
  name: 'overlay',
  loops: [defineLoop({ on: 'ui-flow', run: ['qa'] })],
  prompts: [prompt('review', 'overlay-review'), prompt('qa')],
})

describe('composeDomainPresets', () => {
  it('concatenates loops and merges prompts with later-wins', () => {
    const merged = composeDomainPresets({ name: 'combined', title: 'Combined' }, base, overlay)

    assert.equal(merged.name, 'combined')
    assert.equal(merged.title, 'Combined')

    // loops concatenate, in preset order
    assert.equal(merged.loops.length, 2)
    assert.deepEqual(merged.loops.map(l => [...l.on]), [['major-change'], ['ui-flow']])

    // prompts merge by id, later preset wins, sorted by id
    assert.deepEqual(merged.prompts.map(p => p.id), ['qa', 'review', 'security'])
    assert.equal(merged.prompts.find(p => p.id === 'review')!.instructions, 'overlay-review')
  })

  it('composing is presets-of-presets: the result is itself a preset', () => {
    const parent = composeDomainPresets({ name: 'parent' }, base, overlay)
    const grand = composeDomainPresets({ name: 'grand' }, parent)
    assert.equal(grand.prompts.length, parent.prompts.length)
    assert.equal(grand.name, 'grand')
  })

  it('carries the last declared defaultEvent through composition', () => {
    const triage = defineDomainPreset({ name: 'triage', defaultEvent: 'bug-fix' })
    assert.equal(composeDomainPresets({ name: 'p' }, base, triage).defaultEvent, 'bug-fix')
    // a later preset without one does not clear an earlier default
    assert.equal(composeDomainPresets({ name: 'p' }, triage, overlay).defaultEvent, 'bug-fix')
    // none declared -> absent
    assert.equal('defaultEvent' in composeDomainPresets({ name: 'p' }, base, overlay), false)
  })
})

describe('selectPreset', () => {
  it('picks by name or returns undefined', () => {
    assert.equal(selectPreset([base, overlay], 'overlay'), overlay)
    assert.equal(selectPreset([base, overlay], 'missing'), undefined)
  })
})
