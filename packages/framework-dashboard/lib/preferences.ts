import { useEffect, useSyncExternalStore } from 'react'
import type { Preferences } from '@gemstack/framework'
import { onPreferences, savePreferences } from '../server/preferences.telefunc.js'

// The dashboard's Global options (#410), owned by the daemon and persisted in the same
// `the-framework.json` as the project list — no more localStorage. Loaded once over Telefunc
// and cached in this module so every component (the Start form's toggles + the choice-gate
// countdown) reads one shared value and stays in lockstep: an update writes through to the
// cache, notifies subscribers, and persists daemon-side. Prerender has no daemon, so the
// server snapshot is the empty default and the real values load on the client.

const EMPTY: Preferences = {}
let cache: Preferences | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Preferences {
  return cache ?? EMPTY
}

function ensureLoaded(): void {
  if (cache || loading) return
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

/**
 * Merge a patch into the shared preferences, persist it daemon-side, and notify every
 * subscriber so the Start form and the choice gate stay in lockstep. The write-through keeps
 * the UI responsive; the `savePreferences` round-trip is best-effort (a failed save is not
 * worth surfacing over a checkbox toggle).
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  cache = { ...(cache ?? {}), ...patch }
  notify()
  void savePreferences(cache).catch(() => {})
}

/** The shared user preferences, loaded once from the daemon and kept in sync across components. */
export function usePreferences(): Preferences {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  useEffect(ensureLoaded, [])
  return preferences
}

/** Autopilot defaults on (the demo default), matching the old localStorage semantics. */
export function autopilotEnabled(preferences: Preferences): boolean {
  return preferences.autopilot ?? true
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
