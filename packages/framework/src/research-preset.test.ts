import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderResearchPrompt, RESEARCH_PARAMS, RESEARCH_PROMPT_TEMPLATE } from './research-preset.js'

test('the Research template carries the #331 flow: rating, multi-select gate, TODO entries', () => {
  assert.match(RESEARCH_PROMPT_TEMPLATE, /problem variability/)
  assert.match(RESEARCH_PROMPT_TEMPLATE, /showMultiSelect\(\)/)
  assert.match(RESEARCH_PROMPT_TEMPLATE, /<AWAIT>/)
  assert.match(RESEARCH_PROMPT_TEMPLATE, /<REVIEW_FILE>/)
  assert.match(RESEARCH_PROMPT_TEMPLATE, /<TODO_FILE>/)
  // The one user blank, declared with its default.
  assert.match(RESEARCH_PROMPT_TEMPLATE, /\$\{\{ tf\.params\.what \}\}/)
  assert.deepEqual(RESEARCH_PARAMS.map(p => p.name), ['what'])
})

test('renderResearchPrompt defaults the blank to "this PR" and takes an override', () => {
  const byDefault = renderResearchPrompt()
  assert.match(byDefault, /problem variability" of this PR/)
  const blank = renderResearchPrompt('   ')
  assert.match(blank, /problem variability" of this PR/) // blank falls back, not erased
  const custom = renderResearchPrompt('the auth flow')
  assert.match(custom, /problem variability" of the auth flow/)
  // No raw placeholder survives a render.
  assert.equal(custom.includes('${{'), false)
})
