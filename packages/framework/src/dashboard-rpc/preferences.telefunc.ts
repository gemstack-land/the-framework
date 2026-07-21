import { contextPreferences } from './context.js'
import { detectEditors, type EditorInfo } from '../dashboard/open-in-app.js'
import type { Preferences, ProjectPreferences } from '../registry.js'

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
  // A failed write returns the advertised typed error rather than rejecting the RPC,
  // so the client handles it the same as the not-enabled case (both `{ ok: false }`).
  try {
    await store.save(preferences)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to save preferences' }
  }
}

/**
 * One project's own run options (#840), or `{}` when it overrides nothing / the host stores
 * none. Separate from {@link onPreferences} rather than folded into it: the client needs the
 * two tiers apart to know which one a toggle should write to.
 */
export async function onProjectPreferences(projectId: string): Promise<ProjectPreferences> {
  const store = contextPreferences()
  if (!store?.readProject) return {}
  return store.readProject(projectId).catch(() => ({}))
}

/** Persist one project's run options (#840), sanitized in the store. No-op-safe on a public host. */
export async function saveProjectPreferences(
  projectId: string,
  preferences: ProjectPreferences,
): Promise<SavePreferencesResult> {
  const store = contextPreferences()
  if (!store?.saveProject) return { ok: false, error: 'preferences are not enabled on this server' }
  try {
    await store.saveProject(projectId, preferences)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to save preferences' }
  }
}

/**
 * The editors installed on this server (#727), for the "Preferred editor" picker. Detection reads
 * the daemon's own PATH, so it is gated on the same store presence as the other preference RPCs:
 * a public host (the relay) has no local checkout to open anyway, so it returns `[]`.
 */
export async function onEditors(): Promise<EditorInfo[]> {
  if (!contextPreferences()) return []
  return detectEditors().catch(() => [])
}

/** Which notification channels the daemon can actually deliver on (#948). */
export interface NotifyChannels {
  /** `DISCORD_WEBHOOK` is set, so Discord delivery can fire. */
  discordWebhook: boolean
  /** `DISCORD_BOT_TOKEN` is set, so the Discord chatbot can answer. */
  discordBot: boolean
}

/**
 * Whether the daemon has the Discord env vars (#948). The toggles are per-user preferences,
 * but delivery needs `DISCORD_WEBHOOK` / `DISCORD_BOT_TOKEN` on the daemon — without this
 * read the dashboard let you switch on a channel that delivers nothing and lit the bell for
 * it. Only presence is reported, never the values. Gated like the other preference RPCs, so
 * a public host reports both absent.
 */
export async function onNotifyChannels(): Promise<NotifyChannels> {
  if (!contextPreferences()) return { discordWebhook: false, discordBot: false }
  return {
    discordWebhook: Boolean(process.env.DISCORD_WEBHOOK),
    discordBot: Boolean(process.env.DISCORD_BOT_TOKEN),
  }
}
