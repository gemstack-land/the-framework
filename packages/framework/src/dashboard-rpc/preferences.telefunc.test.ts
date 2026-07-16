import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { provideTelefuncContext } from 'telefunc'
import { onPreferences, savePreferences } from './preferences.telefunc.js'
import type { PreferencesStore } from '../registry.js'

// Outside a Telefunc `serve({ context })` there is no preferences store on the context — the
// same situation as the public relay, which never wires one. The RPCs must degrade safely: a
// read falls back to the empty default, and a write reports it is not enabled rather than
// touching the host's home file.

test('onPreferences with no store returns the empty default', async () => {
  assert.deepEqual(await onPreferences(), {})
})

test('savePreferences with no store is a not-enabled no-op', async () => {
  const result = await savePreferences({ autopilot: false })
  assert.deepEqual(result, { ok: false, error: 'preferences are not enabled on this server' })
})

test('savePreferences returns the typed error when the store write fails, not a rejection', async () => {
  const store: PreferencesStore = {
    read: async () => ({}),
    save: async () => {
      throw new Error('disk full')
    },
  }
  provideTelefuncContext({ preferences: store })
  const result = await savePreferences({ autopilot: true })
  assert.deepEqual(result, { ok: false, error: 'failed to save preferences' })
})
