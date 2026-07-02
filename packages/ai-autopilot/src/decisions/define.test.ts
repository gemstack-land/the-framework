import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defineDecision, DecisionError, slugify, tokenize } from './define.js'

describe('defineDecision', () => {
  it('validates and freezes, defaulting status to rejected and id to a title slug', () => {
    const d = defineDecision({ title: 'Use Redux for State', rationale: 'Too much boilerplate' })
    assert.equal(d.id, 'use-redux-for-state')
    assert.equal(d.status, 'rejected')
    assert.deepEqual(d.tags, [])
    assert.equal('date' in d, false)
    assert.ok(Object.isFrozen(d))
  })

  it('normalizes and de-dupes tags to lowercase', () => {
    const d = defineDecision({ title: 'x', rationale: 'y', tags: ['State', 'state', ' Frontend '] })
    assert.deepEqual(d.tags, ['state', 'frontend'])
  })

  it('keeps an explicit id (slugified) and omits blank optional fields', () => {
    const d = defineDecision({ title: 'x', rationale: 'y', id: 'My Id', date: '  ' })
    assert.equal(d.id, 'my-id')
    assert.equal('date' in d, false)
  })

  it('throws on a missing title, rationale, or unknown status', () => {
    assert.throws(() => defineDecision({ title: '  ', rationale: 'y' }), DecisionError)
    assert.throws(() => defineDecision({ title: 'x', rationale: '' }), DecisionError)
    assert.throws(
      () => defineDecision({ title: 'x', rationale: 'y', status: 'maybe' as never }),
      DecisionError,
    )
  })

  it('throws when a title slugs to nothing and no id is given', () => {
    assert.throws(() => defineDecision({ title: '!!!', rationale: 'y' }), DecisionError)
  })
})

describe('slugify / tokenize', () => {
  it('slugify produces trimmed kebab-case', () => {
    assert.equal(slugify('  Hello, World!!  '), 'hello-world')
  })

  it('tokenize drops stop words and short tokens, de-dupes', () => {
    assert.deepEqual(tokenize('Use the Redux store for state').sort(), ['redux', 'state', 'store'])
  })
})
