import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runOptionsFromPreferences, autopilotEnabled } from './run-options.js'
import { resolvePreferences } from './registry.js'

test('autopilot defaults on when nothing is set (#858)', () => {
  assert.equal(autopilotEnabled({}), true)
  assert.equal(autopilotEnabled({ autopilot: false }), false)
})

test('an empty preference set still starts a run in autopilot (#858)', () => {
  assert.deepEqual(runOptionsFromPreferences({}), { autopilot: true })
})

test('the agent is sent only when it is not the default (#858)', () => {
  // The daemon spells this out as a flag, and `--agent claude` is the default anyway.
  assert.equal(runOptionsFromPreferences({ agent: 'claude' }).agent, undefined)
  assert.equal(runOptionsFromPreferences({ agent: 'codex' }).agent, 'codex')
})

test('the model passes through, and an empty one does not (#858)', () => {
  assert.equal(runOptionsFromPreferences({ model: 'opus' }).model, 'opus')
  assert.equal(runOptionsFromPreferences({ model: '' }).model, undefined)
})

test('browser is dropped for an agent that cannot use it (#801)', () => {
  assert.equal(runOptionsFromPreferences({ browser: true }).browser, true)
  assert.equal(runOptionsFromPreferences({ browser: true, agent: 'codex' }).browser, undefined)
})

test('the eco drops are suppressed under vanilla and transparent (#858)', () => {
  const eco = { eco: true, ecoPlanning: true }
  assert.deepEqual(runOptionsFromPreferences(eco).eco, { autoPlanning: true })
  assert.equal(runOptionsFromPreferences({ ...eco, vanilla: true }).eco, undefined)
  assert.equal(runOptionsFromPreferences({ ...eco, transparent: true }).eco, undefined)
  // Eco on with nothing to drop is not an eco run.
  assert.equal(runOptionsFromPreferences({ eco: true }).eco, undefined)
})

test("a project's settings beat the global ones (#840/#858)", () => {
  // The path auto PM takes: resolve the two tiers, then map the answer.
  const resolved = resolvePreferences({ agent: 'claude', model: 'sonnet' }, { agent: 'codex' })
  const options = runOptionsFromPreferences(resolved)
  assert.equal(options.agent, 'codex')
  assert.equal(options.model, 'sonnet') // untouched by the project tier
})
