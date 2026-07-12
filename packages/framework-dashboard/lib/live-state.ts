import type { FrameworkEvent, ChoiceRequest } from '@gemstack/framework'

// Live-run state derived from the event stream — kept pure so it can be driven and
// tested on its own, away from React. The dashboard is a projection of the same
// events.jsonl the run writes; the interactive gate and the Stop button read that
// projection rather than any extra state.

/** The `choice` event carries the full request; strip the `kind` discriminant. */
type ChoiceEvent = { kind: 'choice' } & ChoiceRequest

/**
 * The choice gate the run is currently parked on, or null. A `choice` event opens a
 * gate; a matching `choice-resolved` (same id) closes it. Later events win, so a
 * re-fired gate (#324 loops the plan approval with a fresh id) supersedes an earlier
 * one, and a resolved gate never lingers.
 */
export function pendingChoice(events: readonly FrameworkEvent[]): ChoiceRequest | null {
  const resolved = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind === 'choice-resolved') {
      resolved.add(event.id)
      continue
    }
    if (event.kind === 'choice' && !resolved.has(event.id)) {
      const { kind: _kind, ...request } = event as ChoiceEvent
      return request
    }
  }
  return null
}

/**
 * Whether the run is still going, i.e. worth showing a Stop button. A run ends with a
 * single `end` event; until one arrives (and once anything has streamed) it is live.
 */
export function isRunActive(events: readonly FrameworkEvent[]): boolean {
  return events.length > 0 && !events.some(event => event.kind === 'end')
}
