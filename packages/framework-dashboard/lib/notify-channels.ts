import { useEffect, useSyncExternalStore } from 'react'
import { onNotifyChannels, type NotifyChannels } from '../server/preferences.telefunc.js'

// What the daemon can deliver on (#948), as one shared value rather than a read per component.
//
// Three places show it — the bell, the settings rows, the Onboarding checklist — and since #1095
// one of them can *change* it. With a poll each, saving a webhook on the settings page left the
// checklist above it still saying "not configured" until its own timer came round, so the page
// disagreed with itself about a fact the user had just established.
//
// Same shape as `preferences.ts` for the same reason: one cache, module-scoped, every reader
// subscribed, and a write reloads it for all of them at once.

let cache: NotifyChannels | null = null
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Nothing configured, nothing storable: what a host reports before the first read lands. */
const EMPTY: NotifyChannels = { discordWebhook: false, discordBot: false, sources: {}, editable: false }

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Read the channels into the cache. Deduped: several components mounting together ask once.
 * A failed read keeps whatever was last known — a daemon hiccup is not evidence a credential
 * went away, and blanking it would flip every row to "not configured".
 */
function load(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = onNotifyChannels()
    .then(next => {
      cache = next
      notify()
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Re-read now. Call after a write, so every reader settles on the new state together. */
export function reloadNotifyChannels(): void {
  void load()
}

/**
 * The channels the daemon can deliver on, or null until the first read lands — null is
 * "not asked yet", which the callers show as capable rather than lighting up "not configured"
 * on a page that has not finished loading.
 */
export function useNotifyChannels(): NotifyChannels | null {
  useEffect(() => {
    if (cache === null) void load()
  }, [])
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => cache,
    // Prerender has no daemon; the real values load on the client.
    () => null,
  )
}

/** The empty reading, for a caller that needs a value rather than a null. */
export { EMPTY as NO_NOTIFY_CHANNELS }
