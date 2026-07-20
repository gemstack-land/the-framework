import { useEffect, useSyncExternalStore } from 'react'
import type { Preferences, ProjectPreferences } from '@gemstack/framework'
import {
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
} from '../server/preferences.telefunc.js'
import { parseRoute } from './route.js'

// The dashboard's Global options (#410), owned by the daemon and persisted in the same
// `the-framework.json` as the project list — no more localStorage. Loaded once over Telefunc
// and cached in this module so every component (the Start form's toggles + the choice-gate
// countdown) reads one shared value and stays in lockstep: an update writes through to the
// cache, notifies subscribers, and persists daemon-side. Prerender has no daemon, so the
// server snapshot is the empty default and the real values load on the client.
//
// Two tiers since #840: the global object, and the open project's own run options on top of it.
// Components never see the split — `usePreferences()` hands back the resolved result, so a
// toggle reads the same way it always did — but a write lands on whichever tier owns the key.

/** Run options a project owns; the rest of {@link Preferences} is global (#840). Mirrors
 * PROJECT_PREFERENCE_KEYS in the framework's registry.ts, kept local so the client bundle does
 * not import the package root (and with it, node). */
const PROJECT_KEYS = new Set<string>([
  'autopilot',
  'technical',
  'vanilla',
  'eco',
  'ecoPlanning',
  'ecoResearch',
  'ecoMaintenance',
  'onBeforeMergeableQuality',
  'browser',
  'transparent',
  'model',
  'agent',
])

const EMPTY: Preferences = {}
let cache: Preferences | null = null
let loading: Promise<void> | null = null
const projects = new Map<string, ProjectPreferences>()
const projectLoads = new Set<string>()
/** Resolved snapshots, one per project, cleared on every notify. `useSyncExternalStore` compares
 * snapshots by identity, so resolving fresh on each read would re-render forever. */
let resolved = new Map<string, Preferences>()
const listeners = new Set<() => void>()

function notify(): void {
  resolved = new Map()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(projectId: string | null): Preferences {
  const key = projectId ?? ''
  const hit = resolved.get(key)
  if (hit) return hit
  const project = projectId ? projects.get(projectId) : undefined
  const value = project ? { ...(cache ?? EMPTY), ...project } : (cache ?? EMPTY)
  resolved.set(key, value)
  return value
}

function ensureLoaded(projectId: string | null): void {
  if (!cache && !loading) {
    loading = onPreferences()
      // `??=`, not `=`: a toggle made while this initial load was in flight already populated
      // the cache and persisted, so the load must not overwrite it with the pre-toggle value.
      .then(preferences => {
        cache ??= preferences
      })
      .catch(() => {
        cache ??= {}
      })
      .finally(() => {
        loading = null
        notify()
      })
  }
  if (!projectId || projects.has(projectId) || projectLoads.has(projectId)) return
  projectLoads.add(projectId)
  void onProjectPreferences(projectId)
    .then(preferences => {
      // Same `??=` reasoning as above: a toggle during the load already wrote this entry.
      if (!projects.has(projectId)) projects.set(projectId, preferences)
    })
    .catch(() => {
      if (!projects.has(projectId)) projects.set(projectId, {})
    })
    .finally(() => {
      projectLoads.delete(projectId)
      notify()
    })
}

/**
 * The project a write belongs to, read straight off the URL (#784 makes it the selection).
 * `updatePreferences` runs in an event handler rather than a render, so it reads the location
 * instead of a hook: no module state to fall out of step with what the user is looking at.
 */
function activeProjectId(): string | null {
  if (typeof window === 'undefined') return null
  return parseRoute(window.location.pathname).projectId
}

/**
 * Merge a patch into the shared preferences, persist it daemon-side, and notify every
 * subscriber so the Start form and the choice gate stay in lockstep. The write-through keeps
 * the UI responsive; the save round-trip is best-effort (a failed save is not worth surfacing
 * over a checkbox toggle).
 *
 * With a project open, the run options in the patch land on that project and the rest stay
 * global (#840) — so changing the model for one repo no longer follows you into the next.
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  const projectId = activeProjectId()
  const entries = Object.entries(patch)
  const projectPatch = projectId ? entries.filter(([key]) => PROJECT_KEYS.has(key)) : []
  const globalPatch = entries.filter(([key]) => !projectId || !PROJECT_KEYS.has(key))

  if (globalPatch.length) {
    cache = { ...(cache ?? {}), ...Object.fromEntries(globalPatch) }
    void savePreferences(cache).catch(() => {})
  }
  if (projectId && projectPatch.length) {
    const next = { ...(projects.get(projectId) ?? {}), ...Object.fromEntries(projectPatch) }
    projects.set(projectId, next)
    void saveProjectPreferences(projectId, next).catch(() => {})
  }
  notify()
}

/**
 * The user preferences in force: the global object, with the open project's own run options
 * on top (#840). Loaded once from the daemon per tier and kept in sync across components.
 */
export function usePreferences(): Preferences {
  const projectId = typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
  const preferences = useSyncExternalStore(
    subscribe,
    () => snapshot(projectId),
    () => EMPTY,
  )
  useEffect(() => ensureLoaded(projectId), [projectId])
  return preferences
}

// Autopilot's default-on moved into @gemstack/framework with the rest of the preferences ->
// run options mapping (#858), so the daemon resolves it the same way. Re-exported here because
// every component reaches for it through this module.
export { autopilotEnabled } from '@gemstack/framework/client'

export type ThemePreference = NonNullable<Preferences['theme']>

/** The chosen dashboard theme (#725); absent follows the OS (`system`). */
export function themePreference(preferences: Preferences): ThemePreference {
  return preferences.theme ?? 'system'
}

/** Whether the dark palette applies, given the theme choice and the OS's dark preference. */
export function resolvedDark(theme: ThemePreference, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** Browser notifications default on (#627); the browser permission is still the real gate. */
export function notificationsEnabled(preferences: Preferences): boolean {
  return preferences.notifyBrowser ?? true
}

/** Discord notifications default off (#627): they reach you with no dashboard open, so opt-in.
 * The daemon's `DISCORD_WEBHOOK` is the other gate (where to post; this is whether to). */
export function discordEnabled(preferences: Preferences): boolean {
  return preferences.notifyDiscord ?? false
}

/** "New activity" notifications default off (#627): the category that pings on a run starting or
 * finishing, not just on things that need you. Composes with the method toggles above — activity
 * reaches the browser when {@link notificationsEnabled}, Discord when {@link discordEnabled}. */
export function newActivityEnabled(preferences: Preferences): boolean {
  return preferences.notifyNewActivity ?? false
}

/** The "needs you" category (#627): a run awaiting your answer, or a PR to review. Composes with
 * the method toggles like {@link newActivityEnabled}, but **defaults on** — these are the baseline
 * notifications, so an unset preference keeps them firing. */
export function humanInterventionEnabled(preferences: Preferences): boolean {
  return preferences.notifyHumanIntervention ?? true
}
