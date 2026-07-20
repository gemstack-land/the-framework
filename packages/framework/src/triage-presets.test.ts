import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderTriageQuickPrompt,
  TRIAGE_QUICK_PARAMS,
  TRIAGE_QUICK_PRESET_NAME,
  TRIAGE_QUICK_PROMPT_TEMPLATE,
  renderTriageConsensualPrompt,
  TRIAGE_CONSENSUAL_PARAMS,
  TRIAGE_CONSENSUAL_PRESET_NAME,
  TRIAGE_CONSENSUAL_PROMPT_TEMPLATE,
} from './triage-presets.js'
import { SUGGEST_TICKETS_TO_WORK_ON_PROMPT_TEMPLATE } from './suggest-tickets-to-work-on-preset.js'

test('the quick triage template picks quick-win AND consensual tickets (#891)', () => {
  assert.equal(TRIAGE_QUICK_PRESET_NAME, 'triage-quick')
  assert.match(TRIAGE_QUICK_PROMPT_TEMPLATE, /Only pick tickets that are quick-wins and consensual/)
  assert.match(TRIAGE_QUICK_PROMPT_TEMPLATE, /Add tickets to TODO_AGENTS\.md/)
  assert.deepEqual(TRIAGE_QUICK_PARAMS, [])
})

test('the consensual triage template excludes quick-wins (#892)', () => {
  assert.equal(TRIAGE_CONSENSUAL_PRESET_NAME, 'triage-consensual')
  // "significant (no quick-wins)" is what keeps the pair disjoint: without the exclusion both
  // presets would queue the same cheap tickets and the split would buy nothing.
  assert.match(TRIAGE_CONSENSUAL_PROMPT_TEMPLATE, /Only pick tickets that are significant \(no quick-wins\) and consensual/)
  assert.match(TRIAGE_CONSENSUAL_PROMPT_TEMPLATE, /Add tickets to TODO_AGENTS\.md/)
  assert.deepEqual(TRIAGE_CONSENSUAL_PARAMS, [])
})

test('each triage preset pins its own session name and aborts on a taken branch (#891/#892)', () => {
  // The collision guard is what makes these safe to fire on a schedule: a triage already in
  // flight owns the branch, so the next firing must do nothing rather than triage twice.
  for (const [render, session] of [
    [renderTriageQuickPrompt, 'triage-quick'],
    [renderTriageConsensualPrompt, 'triage-consensual'],
  ] as const) {
    const out = render()
    assert.match(out, new RegExp(`Always set <SESSION_NAME> to ${session}`))
    assert.match(out, /If branch the-framework\/<SESSION_NAME> already exists, abort and do nothing/)
  }
  // Distinct session names, or the two presets would collide with each other rather than with
  // their own in-flight run.
  assert.notEqual(TRIAGE_QUICK_PRESET_NAME, TRIAGE_CONSENSUAL_PRESET_NAME)
})

test('neither ungated triage preset waits on a human (#891/#892 vs #698)', () => {
  // They run unattended from the rotation, so an <AWAIT> would park the run against nobody.
  // The gated sibling is the one that legitimately has it.
  for (const out of [renderTriageQuickPrompt(), renderTriageConsensualPrompt()]) {
    assert.equal(out.includes('<AWAIT>'), false)
    assert.equal(out.includes('<SHOW_CHOICES>'), false)
    assert.equal(out.includes('showMultiSelect'), false)
  }
  assert.ok(SUGGEST_TICKETS_TO_WORK_ON_PROMPT_TEMPLATE.includes('<AWAIT>'), 'the gated preset still awaits')
})

test('paramless renders are the template verbatim (#891/#892)', () => {
  assert.equal(renderTriageQuickPrompt(), TRIAGE_QUICK_PROMPT_TEMPLATE)
  assert.equal(renderTriageConsensualPrompt(), TRIAGE_CONSENSUAL_PROMPT_TEMPLATE)
  // Nothing to fill, so nothing may survive unrendered either.
  assert.equal(renderTriageQuickPrompt().includes('${{'), false)
  assert.equal(renderTriageConsensualPrompt().includes('${{'), false)
})
