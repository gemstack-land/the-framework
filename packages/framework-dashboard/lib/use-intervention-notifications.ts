import { useEffect, useRef } from 'react'
import type { Intervention } from '@gemstack/framework'
import { interventionKey, pickNewInterventions } from './interventions.js'

// Browser notifications for the "needs you" queue (#627). The interventions list is already
// polled once in the shell; this watches it and fires a notification when a new PR lands. Two
// guards keep it quiet: it never fires unless enabled AND the browser permission is granted,
// and it absorbs the first couple of observations (the initial empty value, then the first
// fetch of already-open PRs) as a baseline — you only get told about items that show up while
// you are watching, not the backlog that existed when the page loaded.

/** Observations to treat as baseline before notifying: the initial `[]` plus the first fetch. */
const WARMUP = 2

/**
 * How a single intervention reads in a notification body: a PR by number, a paused run by its
 * question (#636), a finished run by what is sitting unpushed on its branch (#860).
 */
function label(item: Intervention): string {
  if (item.kind === 'awaiting') return item.title
  if (item.kind === 'unpushed') {
    return `${item.title} — ${item.commits === 1 ? '1 commit' : `${item.commits ?? 0} commits`} not pushed`
  }
  return `#${item.number} ${item.title}`
}

function fire(items: Intervention[]): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const first = items[0]
  if (!first) return
  const single = items.length === 1
  const title = single ? `Needs you · ${first.projectName}` : `${items.length} items need you`
  const body = single ? label(first) : items.map(label).join('\n')
  const notification = new Notification(title, { body })
  notification.onclick = () => {
    // A PR opens on GitHub; a paused run and unpushed work both live in this dashboard, so just
    // bring the tab forward (project selection is client state, not a URL) — the "needs you" card
    // takes it from there.
    if (first.kind === 'awaiting' || first.kind === 'unpushed') window.focus()
    else window.open(first.url, '_blank', 'noopener')
    notification.close()
  }
}

/**
 * Fire a browser notification when a new intervention appears. `enabled` is the user's
 * preference; the browser permission is the other gate (checked in {@link fire}). No-op on the
 * server (no `window`), and harmless when notifications are unsupported.
 */
export function useInterventionNotifications(interventions: Intervention[], enabled: boolean): void {
  const seen = useRef<Set<string>>(new Set())
  const observations = useRef(0)

  useEffect(() => {
    const fresh = pickNewInterventions(seen.current, interventions)
    if (observations.current < WARMUP) {
      observations.current += 1 // still warming up: fold these into the baseline, don't notify
    } else if (enabled && fresh.length > 0) {
      fire(fresh)
    }
    for (const item of interventions) seen.current.add(interventionKey(item))
  }, [interventions, enabled])
}
