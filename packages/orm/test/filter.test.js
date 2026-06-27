// The filter shape: the `isInCondition` membership predicate (shared by every adapter) and the
// in-process matchesFilter that uses it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInCondition, matchesFilter } from '../src/index.js'

test('isInCondition: true only for the { in: [...] } membership form', () => {
  assert.equal(isInCondition({ in: [1, 2] }), true)
  assert.equal(isInCondition({ in: [] }), true)
})

test('isInCondition: false for equality values and lookalikes', () => {
  assert.equal(isInCondition('x'), false)
  assert.equal(isInCondition(5), false)
  assert.equal(isInCondition(null), false)
  assert.equal(isInCondition(undefined), false)
  assert.equal(isInCondition({ in: 'not-an-array' }), false)
  assert.equal(isInCondition({ eq: [1] }), false)
  assert.equal(isInCondition([1, 2]), false) // an array is not an { in } condition
})

test('matchesFilter: equality matches the exact value', () => {
  assert.equal(matchesFilter({ id: 'a', n: 1 }, { id: 'a' }), true)
  assert.equal(matchesFilter({ id: 'a' }, { id: 'b' }), false)
})

test('matchesFilter: membership matches when the value is in the list', () => {
  assert.equal(matchesFilter({ id: 'b' }, { id: { in: ['a', 'b'] } }), true)
  assert.equal(matchesFilter({ id: 'c' }, { id: { in: ['a', 'b'] } }), false)
  assert.equal(matchesFilter({ id: 'a' }, { id: { in: [] } }), false)
})

test('matchesFilter: an empty filter matches every row, multiple keys are AND', () => {
  assert.equal(matchesFilter({ a: 1, b: 2 }, {}), true)
  assert.equal(matchesFilter({ a: 1, b: 2 }, { a: 1, b: { in: [2, 3] } }), true)
  assert.equal(matchesFilter({ a: 1, b: 9 }, { a: 1, b: { in: [2, 3] } }), false)
})
