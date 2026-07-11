import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PARAM_PATTERN } from './preset-params.js'
import {
  renderMaintainabilityMinimalPrompt,
  MAINTAINABILITY_MINIMAL_PARAMS,
  MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE,
} from './maintainability-minimal-preset.js'

test('the minimal Maintainability template carries the bare #362 prompt, no framing or param', () => {
  assert.equal(MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE, 'Look for maintainability red flags, and fix them.')
  // The #362/#361 diff: no target scope and no "as maintainable as possible" framing.
  assert.equal(MAINTAINABILITY_MINIMAL_PARAMS.length, 0)
  assert.doesNotMatch(MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE, /<PARAM:/)
  assert.doesNotMatch(MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE, /as maintainable as possible/)
})

test('renderMaintainabilityMinimalPrompt renders verbatim with no placeholder left', () => {
  const rendered = renderMaintainabilityMinimalPrompt()
  assert.equal(rendered, 'Look for maintainability red flags, and fix them.')
  assert.equal(PARAM_PATTERN.test(rendered), false)
})
