import { contextDiscord, contextPreferences, resolveProjectPath } from './context.js'
import type { DiscordCredentialStatus, DiscordCredentialsPatch } from '../discord-credentials.js'
import { detectEditors, type EditorInfo } from '../dashboard/open-in-app.js'
import { readProjectPresets, writeProjectPresets } from '../project-presets.js'
import type { CustomPreset, Preferences, ProjectPreferences } from '../registry.js'

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
 * A project's shared custom presets (#1025), committed into its `.the-framework/` so they travel
 * with the repo — the team-shared counterpart to the user-tier {@link onPreferences} presets. Read
 * from the project's own checkout, so this resolves the project id to its workspace path rather than
 * touching the home registry. `[]` on a public host (no local checkout) or an unknown project.
 */
export async function onProjectPresets(projectId: string): Promise<CustomPreset[]> {
  if (!contextPreferences()) return []
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  return readProjectPresets(cwd).catch(() => [])
}

/** Persist a project's shared custom presets into its `.the-framework/` (#1025). No-op-safe on a public host. */
export async function saveProjectPresets(
  projectId: string,
  presets: CustomPreset[],
): Promise<SavePreferencesResult> {
  if (!contextPreferences()) return { ok: false, error: 'preferences are not enabled on this server' }
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'unknown project' }
  try {
    await writeProjectPresets(cwd, presets)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to save presets' }
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
  /** A webhook is set, so Discord delivery can fire. */
  discordWebhook: boolean
  /** A bot token is set, so the Discord chatbot can answer. */
  discordBot: boolean
  /**
   * Where each credential came from (#1095), so the UI can offer an edit for one it stores and
   * say "set on the daemon" for one it cannot touch. An absent key means that credential is
   * not set. Still presence, never a value — nothing here can be turned back into a credential.
   */
  sources: DiscordCredentialStatus
  /** Whether this host can store a credential at all. False on a public host, which wires no store. */
  editable: boolean
}

/**
 * Whether the daemon has the Discord credentials (#948/#1095). The toggles are per-user
 * preferences, but delivery needs a webhook / a bot token on the daemon — without this read the
 * dashboard let you switch on a channel that delivers nothing and lit the bell for it.
 *
 * Only presence is reported, never the values, and that is the whole contract: a credential set
 * from the dashboard (#1095) lives daemon-side and is never read back to a browser, so this stays
 * booleans plus where each came from. Gated like the other preference RPCs, so a public host
 * reports both absent.
 */
export async function onNotifyChannels(): Promise<NotifyChannels> {
  const discord = contextDiscord()
  if (!contextPreferences() || !discord) return { discordWebhook: false, discordBot: false, sources: {}, editable: false }
  const sources = await discord.status().catch((): DiscordCredentialStatus => ({}))
  return { discordWebhook: sources.webhook !== undefined, discordBot: sources.botToken !== undefined, sources, editable: true }
}

/**
 * Store (or clear) the Discord credentials from the dashboard (#1095) — the step that used to
 * need an edit to the daemon's environment and a restart, which made it the one onboarding step
 * you could not finish in-product.
 *
 * Write-only on purpose: there is no companion read. The value goes daemon-side, and the browser
 * only ever learns that it is there ({@link onNotifyChannels}). The store applies it live, so the
 * bot connects and the watchers start on the save rather than at the next daemon start.
 *
 * The exposure is bounded by the guard the rest of this surface already sits behind: on a
 * non-loopback bind every route requires the shared token (#1051), and anyone through that guard
 * can start runs — strictly more than setting a webhook URL. A public host wires no store, so
 * this refuses there.
 */
export async function saveDiscordCredentials(patch: DiscordCredentialsPatch): Promise<SavePreferencesResult> {
  const discord = contextDiscord()
  if (!discord) return { ok: false, error: 'Discord cannot be configured on this server.' }
  return discord.save(patch).catch(() => ({ ok: false as const, error: 'failed to save' }))
}
