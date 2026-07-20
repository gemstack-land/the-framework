import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderReadabilityPrompt, READABILITY_PARAMS, READABILITY_PROMPT_TEMPLATE } from './readability-preset.js'

test('the Readability template carries the #360 flow: seams, altitude pass, rating lists', () => {
  assert.match(READABILITY_PROMPT_TEMPLATE, /easy as possible for humans to read/)
  assert.match(READABILITY_PROMPT_TEMPLATE, /Rate the \*seams\*/)
  assert.match(READABILITY_PROMPT_TEMPLATE, /Altitude pass/)
  assert.match(READABILITY_PROMPT_TEMPLATE, /Separate commit for each refactor/)
  // The agent-facing macro is defined at the bottom of the prompt itself.
  assert.match(READABILITY_PROMPT_TEMPLATE, /<FUNCTION>/)
  assert.match(READABILITY_PROMPT_TEMPLATE, /^FUNCTION: /m)
  // The one user blank, declared with its default.
  assert.match(READABILITY_PROMPT_TEMPLATE, /\$\{\{ tf\.params\.what \}\}/)
  assert.deepEqual(READABILITY_PARAMS.map(p => p.name), ['what'])
})

test('renderReadabilityPrompt defaults the blank to the session, else the whole codebase (#874)', () => {
  const byDefault = renderReadabilityPrompt()
  assert.match(byDefault, /^Refactor entire codebase to make it/)
  const blank = renderReadabilityPrompt('   ')
  assert.match(blank, /^Refactor entire codebase to make it/) // blank falls back, not erased
  const custom = renderReadabilityPrompt('the dashboard package')
  assert.match(custom, /^Refactor the dashboard package to make it/)
  // No raw placeholder survives a render; <FUNCTION> is not a param and stays.
  assert.equal(custom.includes('${{'), false)
  assert.match(custom, /<FUNCTION>/)
})
