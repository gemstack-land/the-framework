import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderSuggestNewTicketsPrompt,
  SUGGEST_NEW_TICKETS_PARAMS,
  SUGGEST_NEW_TICKETS_PRESET_NAME,
  SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE,
} from './suggest-new-tickets-preset.js'

test('the Suggest-new-tickets preset is the single #674 line, with no params', () => {
  assert.equal(SUGGEST_NEW_TICKETS_PRESET_NAME, 'suggest-new-tickets')
  // Rom's #674 call: one line, the ambient #683/#684 context carries the ticket format + flow.
  assert.equal(SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE, 'Suggest new tickets')
  // Paramless: nothing to fill, and no leftover `${{ ... }}` blank.
  assert.deepEqual(SUGGEST_NEW_TICKETS_PARAMS, [])
  assert.equal(SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE.includes('${{'), false)
})

test('renderSuggestNewTicketsPrompt returns the template verbatim', () => {
  assert.equal(renderSuggestNewTicketsPrompt(), 'Suggest new tickets')
})
