import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { definePrompt, defineLoop, LoopError } from './define.js'

describe('definePrompt', () => {
  it('defaults passes to 1 and freezes', () => {
    const p = definePrompt({ id: 'review', run: () => 'ok' })
    assert.equal(p.passes, 1)
    assert.ok(Object.isFrozen(p))
  })

  it('rejects a non-kebab id, a missing run, or a bad passes count', () => {
    assert.throws(() => definePrompt({ id: 'Review', run: () => '' }), LoopError)
    assert.throws(() => definePrompt({ id: 'review', run: undefined as never }), LoopError)
    assert.throws(() => definePrompt({ id: 'review', run: () => '', passes: 0 }), LoopError)
    assert.throws(() => definePrompt({ id: 'review', run: () => '', passes: 1.5 }), LoopError)
  })
})

describe('defineLoop', () => {
  it('normalizes a single `on` to a de-duped array', () => {
    const r = defineLoop({ on: 'major-change', run: ['review', 'security'] })
    assert.deepEqual(r.on, ['major-change'])
    assert.deepEqual(r.run, ['review', 'security'])
    assert.ok(Object.isFrozen(r))
  })

  it('de-dupes kinds and requires non-empty on/run', () => {
    assert.deepEqual(defineLoop({ on: ['a', 'a', 'b'], run: ['x'] }).on, ['a', 'b'])
    assert.throws(() => defineLoop({ on: [], run: ['x'] }), LoopError)
    assert.throws(() => defineLoop({ on: 'a', run: [] }), LoopError)
  })
})
