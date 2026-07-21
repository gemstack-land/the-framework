import type { Activity } from './activity.js'
import type { Intervention } from './interventions.js'

/**
 * The stable identity of a watched item, and the "only what is new" diff both notifier paths run.
 *
 * A leaf module on purpose: `activity.ts` and `interventions.ts` build their items by reading the
 * store, so they import `node:*` and cannot be reached from the browser bundle. These four
 * functions are pure and depend on nothing but the item, so they live here and are re-exported
 * from `client.ts` — which is what lets the dashboard share them instead of keeping the copy it
 * used to keep. A copy is not free here: the key IS the identity the daemon dedupes on, so a
 * drifted one silently double-notifies or silently never notifies, with nothing to type-check.
 *
 * The type imports are erased at compile time, so they add no edge to the graph `client.test.ts`
 * walks.
 */

/**
 * The stable identity of an intervention. A PR is its url (survives title edits and re-sorts);
 * the other two are keyed on the project plus the thing waiting — the gate id, or the run whose
 * branch is unpushed — since their url is the shared dashboard URL and would otherwise collide.
 */
export function interventionKey(item: Intervention): string {
  if (item.kind === 'awaiting') return `awaiting:${item.projectId}:${item.awaitId ?? ''}`
  if (item.kind === 'unpushed') return `unpushed:${item.projectId}:${item.runId ?? ''}`
  return item.url
}

/**
 * The interventions in `current` not already in `seen` (by {@link interventionKey}) — the ones
 * that just landed on the queue.
 */
export function pickNewInterventions(seen: ReadonlySet<string>, current: Intervention[]): Intervention[] {
  return current.filter(item => !seen.has(interventionKey(item)))
}

/**
 * The stable identity of an activity item: its kind + project + run. The kind is part of the key
 * so a run's `started` and `finished` are two separate announcements (one when it kicks off, one
 * when it lands), each firing exactly once.
 */
export function activityKey(item: Activity): string {
  return `${item.kind}:${item.projectId}:${item.runId}`
}

/**
 * The activity items in `current` not already in `seen` (by {@link activityKey}) — the transitions
 * that just happened.
 */
export function pickNewActivity(seen: ReadonlySet<string>, current: Activity[]): Activity[] {
  return current.filter(item => !seen.has(activityKey(item)))
}
