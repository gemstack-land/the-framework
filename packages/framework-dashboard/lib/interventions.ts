import type { Intervention } from '@gemstack/framework'

// Client-side helpers for the interventions notification trigger (#627). These live in the
// dashboard rather than @gemstack/framework on purpose: importing runtime values from the
// framework barrel would drag its Node-only + telefunc modules into the browser bundle. Only
// the `Intervention` type is borrowed (types are erased), and that logic is a couple of lines.

/**
 * The stable identity of an intervention. A PR is its url (survives title edits and re-sorts); an
 * awaiting run (#636) and a run with unpushed work (#860) are keyed on the project plus the thing
 * waiting, since their url is the shared dashboard URL and would otherwise collide across
 * projects. Mirrors the server's `interventionKey`.
 */
export function interventionKey(item: Intervention): string {
  if (item.kind === 'awaiting') return `awaiting:${item.projectId}:${item.awaitId ?? ''}`
  if (item.kind === 'unpushed') return `unpushed:${item.projectId}:${item.runId ?? ''}`
  return item.url
}

/**
 * The interventions in `current` not already in `seen` (by {@link interventionKey}) — the ones
 * that just landed on the queue. The shell keeps the keys it has already told the user about,
 * so only genuinely new items fire a notification.
 */
export function pickNewInterventions(seen: ReadonlySet<string>, current: Intervention[]): Intervention[] {
  return current.filter(item => !seen.has(interventionKey(item)))
}
