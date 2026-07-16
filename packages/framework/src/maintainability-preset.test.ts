import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderMaintainabilityPrompt,
  MAINTAINABILITY_PARAMS,
  MAINTAINABILITY_PROMPT_TEMPLATE,
} from './maintainability-preset.js'

test('the Maintainability template carries the #361 prompt: deliberately minimal', () => {
  assert.match(MAINTAINABILITY_PROMPT_TEMPLATE, /as maintainable as possible/)
  assert.match(MAINTAINABILITY_PROMPT_TEMPLATE, /maintainability red flags/)
  // The one user blank, declared with its default.
  assert.match(MAINTAINABILITY_PROMPT_TEMPLATE, /\$\{\{ tf\.params\.what \}\}/)
  assert.deepEqual(MAINTAINABILITY_PARAMS.map(p => p.name), ['what'])
})

test('renderMaintainabilityPrompt defaults the blank to "this PR" and takes an override', () => {
  const byDefault = renderMaintainabilityPrompt()
  assert.match(byDefault, /^Refactor this PR to make it/)
  const blank = renderMaintainabilityPrompt('   ')
  assert.match(blank, /^Refactor this PR to make it/) // blank falls back, not erased
  const custom = renderMaintainabilityPrompt('the queue package')
  assert.match(custom, /^Refactor the queue package to make it/)
  // No raw placeholder survives a render.
  assert.equal(custom.includes('${{'), false)
})
