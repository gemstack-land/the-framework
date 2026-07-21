import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultLoops, LOOP_EVENTS, LOOP_PROMPTS } from './policy.js'

describe('defaultLoops', () => {
  it('maps the two built-in change kinds to their prompt chains', () => {
    const loops = defaultLoops()
    const major = loops.find(r => r.on.includes(LOOP_EVENTS.majorChange))
    const ui = loops.find(r => r.on.includes(LOOP_EVENTS.uiFlow))
    assert.deepEqual(major?.run, [LOOP_PROMPTS.review, LOOP_PROMPTS.codeQuality, LOOP_PROMPTS.security])
    assert.deepEqual(ui?.run, [LOOP_PROMPTS.qa, LOOP_PROMPTS.ux])
  })

  it('defines the production-check gate the bootstrap checklist defaults to (#974)', () => {
    const gate = defaultLoops().find(r => r.on.includes(LOOP_EVENTS.productionCheck))
    assert.deepEqual(gate?.run, [LOOP_PROMPTS.productionGrade])
  })

  it('returns fresh arrays each call (safe to extend)', () => {
    assert.notEqual(defaultLoops(), defaultLoops())
  })
})
