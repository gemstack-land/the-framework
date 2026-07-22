import type { FrameworkEvent, ChoiceRequest } from '@gemstack/framework'

// Live-run state derived from the event stream — kept pure so it can be driven and
// tested on its own, away from React. The dashboard is a projection of the same
// events.jsonl the run writes; the interactive gate and the Stop button read that
// projection rather than any extra state.

/** The `choice` event carries the full request; strip the `kind` discriminant. */
type ChoiceEvent = { kind: 'choice' } & ChoiceRequest

/**
 * Every choice gate the run is currently parked on, in fire order. A `choice` event
 * opens a gate; a matching `choice-resolved` (same id) closes it. A re-fired gate (a new
 * `choice` with an id already open) replaces the earlier one in place; a resolved gate
 * never lingers. The run can park on several gates at once (#440 shows them all at once
 * in the right rail), so this returns the list rather than just the latest.
 */
export function pendingChoices(events: readonly FrameworkEvent[]): ChoiceRequest[] {
  const open = new Map<string, ChoiceRequest>()
  for (const event of events) {
    if (event.kind === 'choice-resolved') {
      open.delete(event.id)
      continue
    }
    if (event.kind === 'choice') {
      const { kind: _kind, ...request } = event as ChoiceEvent
      open.set(event.id, request)
    }
  }
  return [...open.values()]
}

/**
 * One ad-hoc markdown view the agent pushed to the right rail (#441): the `view` event
 * minus its discriminant, derived so a field added to the event carries through here on
 * its own — the same way {@link ChoiceEvent} tracks the `choice` event.
 */
type ViewEvent = Extract<FrameworkEvent, { kind: 'view' }>
export type AgentView = Omit<ViewEvent, 'kind'>

/**
 * Every markdown view the agent has shown this run (#441), in first-seen order. A `view`
 * event with an id already seen updates it in place (the agent re-showed the same title),
 * so the rail keeps one entry per view rather than stacking duplicates.
 */
export function agentViews(events: readonly FrameworkEvent[]): AgentView[] {
  const byId = new Map<string, AgentView>()
  for (const event of events) {
    // Strip the discriminant and keep the rest, like pendingChoices — a new field on the
    // view event is then carried without touching this.
    if (event.kind === 'view') {
      const { kind: _kind, ...view } = event
      byId.set(event.id, view)
    }
  }
  return [...byId.values()]
}

/**
 * Whether the run is still going, i.e. worth showing a Stop button. A run ends with a
 * single `end` event; until one arrives (and once anything has streamed) it is live.
 */
export function isRunActive(events: readonly FrameworkEvent[]): boolean {
  return events.length > 0 && !events.some(event => event.kind === 'end')
}

/** How a run ended, off its single `end` event. */
export interface RunOutcome {
  ok: boolean
  stopped: boolean
  detail?: string
}

/**
 * The run's ending, or undefined while it is still going (#948). The most important bit
 * about a finished run used to live only in one small `✗ failed` feed line — the overview
 * pill said "finished" for a crash and a clean pass alike.
 */
export function runOutcome(events: readonly FrameworkEvent[]): RunOutcome | undefined {
  const end = events.find(event => event.kind === 'end')
  if (!end || end.kind !== 'end') return undefined
  return { ok: end.ok, stopped: end.stopped === true, ...(end.detail !== undefined ? { detail: end.detail } : {}) }
}

/**
 * The GitHub Actions run's live URL, from the `action` event the ActionsDriver emits once it
 * finds its workflow run (#1053): its label is `run <html_url>`. Lets the run view link through
 * to the live Actions run while the transcript is still burst-replaying at the end. The last
 * match wins, so a multi-turn session points at its most recent run. Absent until the driver has
 * found the run (and for any non-Actions target).
 */
export function actionsRunUrl(events: readonly FrameworkEvent[]): string | undefined {
  let url: string | undefined
  for (const event of events) {
    if (event.kind !== 'driver' || event.event.type !== 'action') continue
    const match = /^run (https?:\/\/\S+)$/.exec(event.event.label)
    if (match) url = match[1]
  }
  return url
}

/**
 * The current run's slice of an accumulated live feed. The dashboard's live channel keeps
 * one long-lived subscription per project and appends every streamed event, but each run
 * truncates `events.jsonl` on disk and opens with exactly one `session` event
 * (`emitSessionStart`). So a subscription that spans a run boundary ends up holding the
 * previous run's log followed by the new one. Keep only the tail from the last `session`
 * event — that is the run in progress; a feed with no `session` yet is returned whole. This
 * stops a fresh run's live view (and the right-rail choices/views) from showing the prior run.
 */
export function currentRunEvents(events: readonly FrameworkEvent[]): FrameworkEvent[] {
  let start = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.kind === 'session') {
      start = i
      break
    }
  }
  return events.slice(start)
}
