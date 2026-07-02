import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerdict, isPassing } from './verdict.js'

describe('parseVerdict', () => {
  it('reads a fenced json block with an empty blockers list (passing)', () => {
    const text = 'Everything checks out.\n\n```json\n{ "blockers": [] }\n```'
    const v = parseVerdict(text)
    assert.deepEqual(v, { blockers: [] })
    assert.equal(isPassing(v), true)
  })

  it('reads blockers and trims/drops empties', () => {
    const text = '```json\n{ "blockers": ["no auth", "  ", "no tests"] }\n```'
    const v = parseVerdict(text)
    assert.deepEqual(v?.blockers, ['no auth', 'no tests'])
    assert.equal(isPassing(v), false)
  })

  it('keeps an optional notes field', () => {
    const v = parseVerdict('```json\n{ "blockers": [], "notes": "ship it" }\n```')
    assert.equal(v?.notes, 'ship it')
  })

  it('takes the last verdict when several appear (a corrected pass wins)', () => {
    const text =
      'draft:\n```json\n{ "blockers": ["x"] }\n```\nfinal:\n```json\n{ "blockers": [] }\n```'
    assert.deepEqual(parseVerdict(text)?.blockers, [])
  })

  it('falls back to a trailing bare object', () => {
    const v = parseVerdict('Verdict: { "blockers": ["needs migrations"] }')
    assert.deepEqual(v?.blockers, ['needs migrations'])
  })

  it('returns undefined when there is no verdict (distinct from failing)', () => {
    assert.equal(parseVerdict('just prose, no json'), undefined)
    assert.equal(parseVerdict(''), undefined)
    // an object without a blockers array is not a verdict
    assert.equal(parseVerdict('```json\n{ "ok": true }\n```'), undefined)
    assert.equal(isPassing(undefined), false)
  })
})
