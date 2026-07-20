import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runOptionsFromPreferences, autopilotEnabled, preferencesFromFileConfig } from './run-options.js'
import { resolvePreferences } from './registry.js'

test('autopilot defaults on when nothing is set (#858)', () => {
  assert.equal(autopilotEnabled({}), true)
  assert.equal(autopilotEnabled({ autopilot: false }), false)
})

test('an empty preference set still starts a run in autopilot (#858)', () => {
  // The four yml-owned toggles travel explicitly since #842, so the run states the settled answer
  // rather than letting the repo file fill the silence.
  assert.deepEqual(runOptionsFromPreferences({}), {
    autopilot: true,
    technical: false,
    vanilla: false,
    transparent: false,
  })
})

test('the yml-owned toggles travel as explicit booleans (#842)', () => {
  const off = runOptionsFromPreferences({ autopilot: false })
  assert.equal(off.autopilot, false)
  const on = runOptionsFromPreferences({ technical: true, vanilla: true, transparent: true })
  assert.deepEqual(
    { technical: on.technical, vanilla: on.vanilla, transparent: on.transparent },
    { technical: true, vanilla: true, transparent: true },
  )
})

test('preferencesFromFileConfig maps the repo yml onto the preference keys (#842)', () => {
  assert.deepEqual(preferencesFromFileConfig({}), {})
  assert.deepEqual(preferencesFromFileConfig({ autopilot: true, technical: false }), {
    autopilot: true,
    technical: false,
  })
  // antiLazyPill is the file's name for the inverse of Vanilla.
  assert.deepEqual(preferencesFromFileConfig({ antiLazyPill: false }), { vanilla: true })
  assert.deepEqual(preferencesFromFileConfig({ antiLazyPill: true }), { vanilla: false })
  assert.deepEqual(preferencesFromFileConfig({ transparent: true }), { transparent: true })
  // preset and event have no preference counterpart, so they are not mapped.
  assert.deepEqual(preferencesFromFileConfig({ preset: 'software-development', event: 'bug-fix' }), {})
})

test('a repo yml sits under the project overrides and over the global tier (#842)', () => {
  const global = { autopilot: true, technical: true }
  const repo = preferencesFromFileConfig({ technical: false, antiLazyPill: false })
  // The layer order the daemon and the launcher both use: global, repo, then the project's own.
  const resolved = resolvePreferences({ ...global, ...repo }, { vanilla: false })
  assert.equal(resolved.autopilot, true) // nobody nearer set it
  assert.equal(resolved.technical, false) // the repo turned it off
  assert.equal(resolved.vanilla, false) // the project overrode the repo's antiLazyPill:false
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
