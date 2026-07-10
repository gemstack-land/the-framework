import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  extractParamNames,
  renderPresetPrompt,
  unfilledParams,
  PresetParamError,
} from './preset-params.js'

const RESEARCH = 'Measure "problem variability" of `<PARAM:what>`.'

test('extractParamNames returns distinct names in first-seen order', () => {
  assert.deepEqual(extractParamNames('<PARAM:a> then <PARAM:b> then <PARAM:a>'), ['a', 'b'])
  assert.deepEqual(extractParamNames('no params here'), [])
})

test('renderPresetPrompt substitutes a supplied value', () => {
  assert.equal(
    renderPresetPrompt(RESEARCH, { values: { what: 'the auth module' } }),
    'Measure "problem variability" of `the auth module`.',
  )
})

test('renderPresetPrompt falls back to a declared default', () => {
  assert.equal(
    renderPresetPrompt(RESEARCH, { params: [{ name: 'what', default: 'this PR' }] }),
    'Measure "problem variability" of `this PR`.',
  )
})

test('a supplied value overrides the default', () => {
  assert.equal(
    renderPresetPrompt(RESEARCH, {
      params: [{ name: 'what', default: 'this PR' }],
      values: { what: 'the router' },
    }),
    'Measure "problem variability" of `the router`.',
  )
})

test('a blank value falls back to the default (cleared field keeps the default)', () => {
  assert.equal(
    renderPresetPrompt(RESEARCH, {
      params: [{ name: 'what', default: 'this PR' }],
      values: { what: '   ' },
    }),
    'Measure "problem variability" of `this PR`.',
  )
})

test('every occurrence of a repeated placeholder is replaced', () => {
  assert.equal(
    renderPresetPrompt('<PARAM:x> and again <PARAM:x>', { values: { x: 'y' } }),
    'y and again y',
  )
})

test('renderPresetPrompt throws PresetParamError listing unfilled params', () => {
  assert.throws(
    () => renderPresetPrompt('<PARAM:what> in <PARAM:where>', { values: { what: 'x' } }),
    (err: unknown) => {
      assert.ok(err instanceof PresetParamError)
      assert.deepEqual(err.missing, ['where'])
      return true
    },
  )
})

test('unfilledParams returns descriptors for blanks the user must fill', () => {
  const template = 'do <PARAM:what> in <PARAM:where>'
  const filled = unfilledParams(template, {
    params: [
      { name: 'what', default: 'this PR' },
      { name: 'where', description: 'target directory' },
    ],
    values: {},
  })
  assert.deepEqual(filled, [{ name: 'where', description: 'target directory' }])
})

test('unfilledParams falls back to a bare descriptor for an undeclared param', () => {
  assert.deepEqual(unfilledParams('<PARAM:foo>'), [{ name: 'foo' }])
})
