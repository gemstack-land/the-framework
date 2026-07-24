import { useEffect, useRef } from 'react'
import type { Activity, Intervention } from '@gemstack/the-framework'
import { activityKey, interventionKey, pickNewActivity, pickNewInterventions } from '@gemstack/the-framework/client'

// Browser notifications for the two feeds the shell already polls (#627): the "needs you"
// queue and the "new activity" feed. One engine — the identity half (key + new-item pick) is
// the same code the daemon's Discord notifier runs, imported from the framework so the two
// surfaces cannot drift (#935 unified the server side; this is the client side of the same
// move). What differs per feed is wording and where a click goes, which is what a spec is.
//
// Two guards keep it quiet: it never fires unless enabled AND the browser permission is
// granted, and it absorbs the first couple of observations (the initial empty value, then the
// first fetch of already-known items) as a baseline — you only hear about things that happen
// while you are watching, never the backlog that existed when the page loaded.

/** Observations to treat as baseline before notifying: the initial `[]` plus the first fetch. */
const WARMUP = 2

/** The per-feed half: identity (shared with the daemon's notifier) plus wording and click target. */
interface NotificationSpec<T> {
  pickNew: (seen: Set<string>, items: T[]) => T[]
  keyOf: (item: T) => string
  title: (first: T, count: number) => string
  /** How one item reads in the notification body. */
  label: (item: T) => string
  /** An external URL a click opens; `undefined` brings this tab forward instead. */
  clickUrl: (first: T) => string | undefined
}

function fire<T>(items: T[], spec: NotificationSpec<T>): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const first = items[0]
  if (!first) return
  const notification = new Notification(spec.title(first, items.length), { body: items.map(spec.label).join('\n') })
  notification.onclick = () => {
    const url = spec.clickUrl(first)
    if (url) window.open(url, '_blank', 'noopener')
    else window.focus()
    notification.close()
  }
}

/**
 * Fire a browser notification when a new item appears in a watched feed. `enabled` folds the
 * gates the caller owns (the category toggle AND the browser method); the browser permission is
 * the remaining gate (checked in {@link fire}). No-op on the server (no `window`), and harmless
 * when notifications are unsupported.
 */
function useNewItemNotifications<T>(items: T[], enabled: boolean, spec: NotificationSpec<T>): void {
  const seen = useRef<Set<string>>(new Set())
  const observations = useRef(0)

  useEffect(() => {
    const fresh = spec.pickNew(seen.current, items)
    if (observations.current < WARMUP) {
      observations.current += 1 // still warming up: fold these into the baseline, don't notify
    } else if (enabled && fresh.length > 0) {
      fire(fresh, spec)
    }
    for (const item of items) seen.current.add(spec.keyOf(item))
    // The spec is a module const (stable identity), so the feed and the toggle are the deps.
  }, [items, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}

const INTERVENTIONS: NotificationSpec<Intervention> = {
  pickNew: pickNewInterventions,
  keyOf: interventionKey,
  title: (first, count) => (count === 1 ? `Human Queue · ${first.projectName}` : `${count} items in your Human Queue`),
  // A PR by number, a paused run by its question (#636), a finished run by what sits unpushed (#860).
  label: item => {
    if (item.kind === 'awaiting') return item.title
    if (item.kind === 'unpushed') {
      return item.commits === undefined || item.commits === 0
        ? `${item.title} — work not pushed`
        : `${item.title} — ${item.commits === 1 ? '1 commit' : `${item.commits} commits`} not pushed`
    }
    return `#${item.number} ${item.title}`
  },
  // A PR opens on GitHub; a paused run and unpushed work both live in this dashboard, so those
  // just bring the tab forward (project selection is client state, not a URL).
  clickUrl: first => (first.kind === 'awaiting' || first.kind === 'unpushed' ? undefined : first.url),
}

const ACTIVITY: NotificationSpec<Activity> = {
  pickNew: pickNewActivity,
  keyOf: activityKey,
  title: (first, count) =>
    count === 1 ? `${first.kind === 'started' ? 'Session started' : 'Session finished'} · ${first.projectName}` : `${count} session updates`,
  label: item => `${item.kind === 'started' ? 'Started' : 'Finished'}: ${item.title ?? 'a session'}`,
  // Activity lives in this dashboard (no external URL like a PR) — the runs rail takes it from there.
  clickUrl: () => undefined,
}

/** Notify when a new "needs you" item appears (#627). */
export function useInterventionNotifications(interventions: Intervention[], enabled: boolean): void {
  useNewItemNotifications(interventions, enabled, INTERVENTIONS)
}

/** Notify when a run starts or finishes (#627). */
export function useActivityNotifications(activity: Activity[], enabled: boolean): void {
  useNewItemNotifications(activity, enabled, ACTIVITY)
}
