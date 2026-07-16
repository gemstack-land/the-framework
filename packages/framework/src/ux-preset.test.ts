import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderUxPrompt, UX_PARAMS, UX_PROMPT_TEMPLATE } from './ux-preset.js'

test('the UX template carries the #472 flow: usability review, showChoices gate, work accepted', () => {
  assert.match(UX_PROMPT_TEMPLATE, /^Thoroughly review UX/)
  assert.match(UX_PROMPT_TEMPLATE, /usability perspective/)
  assert.match(UX_PROMPT_TEMPLATE, /showChoices\(\)/)
  assert.match(UX_PROMPT_TEMPLATE, /<AWAIT>/)
  assert.match(UX_PROMPT_TEMPLATE, /Work on all accepted proposals/)
  // The one user blank, declared with its default.
  assert.match(UX_PROMPT_TEMPLATE, /\$\{\{ tf\.params\.what \}\}/)
  assert.deepEqual(UX_PARAMS.map(p => p.name), ['what'])
})

test('renderUxPrompt defaults the blank to "this PR" and takes an override', () => {
  const byDefault = renderUxPrompt()
  assert.match(byDefault, /^Thoroughly review UX of this PR/)
  const blank = renderUxPrompt('   ')
  assert.match(blank, /^Thoroughly review UX of this PR/) // blank falls back, not erased
  const custom = renderUxPrompt('the settings page')
  assert.match(custom, /^Thoroughly review UX of the settings page/)
  // No raw placeholder survives a render.
  assert.equal(custom.includes('${{'), false)
})
