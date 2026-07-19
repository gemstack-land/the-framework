import { useEffect, useRef } from 'react'
import type { Activity } from '@gemstack/framework'
import { activityKey, pickNewActivity } from './activity.js'

// Browser notifications for the "New activity" category (#627). Mirrors use-intervention-
// notifications.ts: the activity feed is polled once in the shell; this watches it and fires a
// notification when a run starts or finishes. Same two guards — never fires unless enabled AND the
// browser permission is granted, and it absorbs the first couple of observations (the initial `[]`
// then the first fetch of already-known runs) as a baseline, so the runs that already exist when the
// page loads are never announced. You only hear about transitions that happen while you are watching.

/** Observations to treat as baseline before notifying: the initial `[]` plus the first fetch. */
const WARMUP = 2

/** How one activity item reads in a notification body: a started run vs a finished one. */
function label(item: Activity): string {
  const what = item.title ?? 'a session'
  return item.kind === 'started' ? `Started: ${what}` : `Finished: ${what}`
}

function title(item: Activity, count: number): string {
  if (count > 1) return `${count} session updates`
  const verb = item.kind === 'started' ? 'Session started' : 'Session finished'
  return `${verb} · ${item.projectName}`
}

function fire(items: Activity[]): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const first = items[0]
  if (!first) return
  const single = items.length === 1
  const body = single ? label(first) : items.map(label).join('\n')
  // Activity lives in this dashboard (no external URL like a PR), so a click just brings the tab
  // forward — the runs rail takes it from there.
  const notification = new Notification(title(first, items.length), { body })
  notification.onclick = () => {
    window.focus()
    notification.close()
  }
}

/**
 * Fire a browser notification when a run starts or finishes. `enabled` folds both gates the caller
 * owns: the "New activity" category being on AND the browser method being on. The browser permission
 * is the remaining gate (checked in {@link fire}). No-op on the server (no `window`), and harmless
 * when notifications are unsupported.
 */
export function useActivityNotifications(activity: Activity[], enabled: boolean): void {
  const seen = useRef<Set<string>>(new Set())
  const observations = useRef(0)

  useEffect(() => {
    const fresh = pickNewActivity(seen.current, activity)
    if (observations.current < WARMUP) {
      observations.current += 1 // still warming up: fold these into the baseline, don't notify
    } else if (enabled && fresh.length > 0) {
      fire(fresh)
    }
    for (const item of activity) seen.current.add(activityKey(item))
  }, [activity, enabled])
}
