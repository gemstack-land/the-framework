import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRunDriver } from './run-driver.js'
import { ActionsDriver, ClaudeCodeDriver, CodexDriver } from './driver/index.js'

// The run-target wrapper (#1050): `--run-on actions` becomes an ActionsDriver (#934); anything else
// falls through to the local agent driver, byte-identical to before.

const ACTIONS = { owner: 'gemstack-land', repo: 'gemstack', token: 't' }

test('createRunDriver returns an ActionsDriver for target "actions"', () => {
  const driver = createRunDriver({ agent: 'claude', target: 'actions', actionsConfig: ACTIONS })
  assert.ok(driver instanceof ActionsDriver)
})

test('createRunDriver falls through to the local agent driver otherwise', () => {
  assert.ok(createRunDriver({ agent: 'claude' }) instanceof ClaudeCodeDriver)
  assert.ok(createRunDriver({ agent: 'claude', target: 'local' }) instanceof ClaudeCodeDriver)
  assert.ok(createRunDriver({ agent: 'codex', target: 'local' }) instanceof CodexDriver)
})

test('createRunDriver requires the Actions config when target is "actions"', () => {
  assert.throws(() => createRunDriver({ agent: 'claude', target: 'actions' }), /needs the repo owner/)
})
