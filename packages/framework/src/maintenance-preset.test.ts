import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderMaintenancePrompt,
  MAINTENANCE_PARAMS,
  MAINTENANCE_PRESET_NAME,
  MAINTENANCE_PROMPT_TEMPLATE,
} from './maintenance-preset.js'
import { presetFilePath } from './preset-registry.js'

test('the Maintenance template queues work rather than doing it (#881)', () => {
  assert.equal(MAINTENANCE_PRESET_NAME, 'maintenance')
  assert.match(MAINTENANCE_PROMPT_TEMPLATE, /look for opportunities to refactor code/)
  assert.match(MAINTENANCE_PROMPT_TEMPLATE, /TODO_AGENTS\.md \(usually as low priority\)/)
  assert.match(MAINTENANCE_PROMPT_TEMPLATE, /<CODEBASE_SUBSET>/)
  assert.deepEqual(MAINTENANCE_PARAMS.map(p => p.name), ['what'])
})

test('it points at the other presets by their real file paths (#881)', () => {
  const out = renderMaintenancePrompt()
  assert.ok(out.includes(presetFilePath('maintainability')), 'expected the maintainability path')
  assert.ok(out.includes(presetFilePath('security_audit')), 'expected the security_audit path')
  // No raw placeholder survives a render — the whole point of flattening the nested fragment.
  assert.equal(out.includes('${{'), false)
})

test('readability is queued only under technical_control (#881)', () => {
  const off = renderMaintenancePrompt(undefined, { settings: { technical_control: false } })
  assert.equal(off.includes(presetFilePath('readability')), false)
  // Absent settings behave like off, and must not throw.
  assert.equal(renderMaintenancePrompt().includes(presetFilePath('readability')), false)

  const on = renderMaintenancePrompt(undefined, { settings: { technical_control: true } })
  assert.ok(on.includes(presetFilePath('readability')), 'expected the readability path')
  assert.equal(on.includes('${{'), false)
})

test('the sweep target defaults to the session, else the whole codebase (#874/#881)', () => {
  assert.match(renderMaintenancePrompt(), /^Analyze entire codebase and/)
  assert.match(renderMaintenancePrompt(undefined, { session_name: 'fix-login' }), /^Analyze fix-login and/)
  assert.match(renderMaintenancePrompt('the auth package'), /^Analyze the auth package and/)
})
