import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { builtinLibrary, builtinPrompts, PromptLibrary } from './library.js'
import { LOOP_PROMPTS, LOOP_EVENTS, defaultLoopRules } from '../loop/policy.js'

describe('builtin prompts', () => {
  it('ships a body for every id the default loop policy references', async () => {
    const library = await builtinLibrary()
    const referenced = new Set(defaultLoopRules().flatMap(r => r.run))
    for (const id of referenced) {
      assert.ok(library.get(id), `built-in prompt "${id}" exists`)
      assert.ok(library.get(id)!.instructions.length > 0, `prompt "${id}" has a body`)
    }
    // the canonical ids resolve
    assert.ok(library.get(LOOP_PROMPTS.review))
    assert.ok(library.get(LOOP_PROMPTS.security))
  })

  it('groups prompts by their loop event', async () => {
    const library = await builtinLibrary()
    const majorIds = library.byEvent(LOOP_EVENTS.majorChange).map(p => p.id)
    assert.ok(majorIds.includes('review'))
    assert.ok(majorIds.includes('code-quality'))
    assert.ok(majorIds.includes('security'))
    const uiIds = library.byEvent(LOOP_EVENTS.uiFlow).map(p => p.id)
    assert.deepEqual(uiIds.sort(), ['qa', 'ux'])
  })

  it('also ships the standalone bodies (refactor, knowledge-base, tldr)', async () => {
    const ids = (await builtinPrompts()).map(p => p.id)
    for (const id of ['refactor', 'knowledge-base', 'review-tldr']) {
      assert.ok(ids.includes(id), `ships "${id}"`)
    }
  })
})

describe('PromptLibrary', () => {
  it('get/add/all keyed by id, sorted', () => {
    const lib = new PromptLibrary()
    lib.add({ id: 'b', name: 'b', title: 'b', description: '', instructions: 'x', passes: 1, appliesTo: [] })
    lib.add({ id: 'a', name: 'a', title: 'a', description: '', instructions: 'y', passes: 1, appliesTo: [] })
    assert.deepEqual(lib.ids(), ['a', 'b'])
    assert.equal(lib.get('a')?.instructions, 'y')
    assert.equal(lib.size, 2)
  })
})
