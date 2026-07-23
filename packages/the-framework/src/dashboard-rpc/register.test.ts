import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { registerDashboardTelefunctions, registeredTelefunctionNames } from './register.js'
import * as reads from './reads.telefunc.js'
import * as control from './control.telefunc.js'
import * as events from './events.telefunc.js'
import * as projects from './projects.telefunc.js'
import * as preferences from './preferences.telefunc.js'
import * as quota from './quota.telefunc.js'
import * as devices from './devices.telefunc.js'

// Every telefunction the dashboard can call has to be registered here, because the daemon
// serves a prebuilt bundle and has no Vite transform to discover them by file path. One that
// is exported but not registered fails at runtime with a 400 and nothing else, which is how
// per-project preferences shipped broken (#866): the client called `saveProjectPreferences`,
// the daemon had never heard of it, and the caller swallowed the rejection.
const MODULES: Array<[string, Record<string, unknown>]> = [
  ['reads', reads],
  ['control', control],
  ['events', events],
  ['projects', projects],
  ['preferences', preferences],
  ['quota', quota],
  ['devices', devices],
]

test('every exported telefunction is registered (#866)', () => {
  registerDashboardTelefunctions()
  const registered = registeredTelefunctionNames()
  const missing: string[] = []
  for (const [module, exports] of MODULES) {
    for (const [name, value] of Object.entries(exports)) {
      if (typeof value !== 'function') continue
      if (!registered.has(name)) missing.push(`${module}.${name}`)
    }
  }
  assert.deepEqual(missing, [], `not registered, so the daemon answers 400: ${missing.join(', ')}`)
})

test('the two per-project preference telefunctions are registered (#866)', () => {
  registerDashboardTelefunctions()
  const registered = registeredTelefunctionNames()
  assert.equal(registered.has('onProjectPreferences'), true)
  assert.equal(registered.has('saveProjectPreferences'), true)
})
