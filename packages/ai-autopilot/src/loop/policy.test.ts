import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultLoopRules, LOOP_EVENTS, LOOP_PROMPTS } from './policy.js'

describe('defaultLoopRules', () => {
  it('maps the two built-in change kinds to their prompt chains', () => {
    const rules = defaultLoopRules()
    const major = rules.find(r => r.on.includes(LOOP_EVENTS.majorChange))
    const ui = rules.find(r => r.on.includes(LOOP_EVENTS.uiFlow))
    assert.deepEqual(major?.run, [LOOP_PROMPTS.review, LOOP_PROMPTS.codeQuality, LOOP_PROMPTS.security])
    assert.deepEqual(ui?.run, [LOOP_PROMPTS.qa, LOOP_PROMPTS.ux])
  })

  it('returns fresh arrays each call (safe to extend)', () => {
    assert.notEqual(defaultLoopRules(), defaultLoopRules())
  })
})
