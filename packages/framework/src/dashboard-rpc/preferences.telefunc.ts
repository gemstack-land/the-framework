import { contextPreferences } from './context.js'
import type { Preferences } from '../registry.js'

// The user-preferences surface behind the new dashboard (#410): the Global options (Autopilot,
// Technical, Vanilla, Eco + its section drops) the Start form and choice gate share. Persisted
// daemon-side in the same `the-framework.json` as the project list, so they survive restarts
// with no localStorage. The store is threaded through the Telefunc request context by the
// daemon (the real registry file); a public host (the relay) leaves it unwired, so reads fall
// back to defaults and writes report they are not enabled.

/** The outcome of a {@link savePreferences} write. */
export type SavePreferencesResult = { ok: true } | { ok: false; error: string }

/** The user's stored dashboard preferences, or `{}` on a host that has none / does not store them. */
export async function onPreferences(): Promise<Preferences> {
  const store = contextPreferences()
  if (!store) return {}
  return store.read().catch(() => ({}))
}

/** Persist the dashboard preferences (sanitized in the store). No-op-safe on a public host. */
export async function savePreferences(preferences: Preferences): Promise<SavePreferencesResult> {
  const store = contextPreferences()
  if (!store) return { ok: false, error: 'preferences are not enabled on this server' }
  await store.save(preferences)
  return { ok: true }
}
