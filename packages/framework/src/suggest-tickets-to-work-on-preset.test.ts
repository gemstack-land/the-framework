import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderSuggestTicketsToWorkOnPrompt,
  SUGGEST_TICKETS_TO_WORK_ON_PARAMS,
  SUGGEST_TICKETS_TO_WORK_ON_PRESET_NAME,
} from './suggest-tickets-to-work-on-preset.js'

test('the preset carries the #698 flow: pick, multi-select, await, queue', () => {
  const prompt = renderSuggestTicketsToWorkOnPrompt()
  assert.match(prompt, /Look at all tickets and pick tickets to work on next/)
  assert.match(prompt, /showMultiSelect\(\)/)
  assert.match(prompt, /<AWAIT>/)
  assert.match(prompt, /Add approved tickets to `TODO_AGENTS\.md`/)
})

test('the preset pre-selects by confidence, which is why it multi-selects (#698)', () => {
  // showChoices() is pick-exactly-one and has nowhere to put a per-entry default, so the
  // OP's <SHOW_CHOICES> has to render as showMultiSelect() for the pre-selection to mean
  // anything. Pin both halves together: the default is the reason for the control.
  const prompt = renderSuggestTicketsToWorkOnPrompt()
  assert.match(prompt, /set its default to `true`, otherwise `false`/)
  assert.doesNotMatch(prompt, /showChoices\(\)/)
})

test('the preset declares the AWAIT legend the protocol expects (#698)', () => {
  // Without the legend line the <AWAIT> tag is just text, and the agent decides for the user.
  assert.match(renderSuggestTicketsToWorkOnPrompt(), /^AWAIT: Stop, await user answer before resuming$/m)
})

test('the preset targets the flat queue, not a session-scoped backlog (#698)', () => {
  // The tooltip promises TODO_AGENTS.md, and #773's unattended path writes the same file;
  // a TODO_<slug>.agent.md here would quietly split the queue in two.
  assert.doesNotMatch(renderSuggestTicketsToWorkOnPrompt(), /TODO_<SESSION_NAME>|\.agent\.md/)
})

test('the preset is paramless and names itself for the `/` menu (#698)', () => {
  assert.equal(SUGGEST_TICKETS_TO_WORK_ON_PRESET_NAME, 'suggest-tickets-to-work-on')
  assert.deepEqual(SUGGEST_TICKETS_TO_WORK_ON_PARAMS, [])
})
