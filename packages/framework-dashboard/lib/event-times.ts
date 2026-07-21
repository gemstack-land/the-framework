import type { FrameworkEvent } from '@gemstack/framework'

// Arrival times for the live feed (#948). A FrameworkEvent carries no timestamp, so the
// dashboard stamps each one as it comes off the channel. A side table rather than a field:
// the event type stays the framework's, and everything downstream (live-state selectors,
// the replay path, tests) keeps passing plain FrameworkEvent[] around. Replayed events are
// never stamped, so a past run simply shows no times instead of wrong ones.
const receivedTimes = new WeakMap<FrameworkEvent, number>()

/** Stamp an event with "now" as it arrives off the live channel. */
export function stampReceived(event: FrameworkEvent): void {
  receivedTimes.set(event, Date.now())
}

/** When the event arrived, or undefined for one that was never live (replay). */
export function receivedAt(event: FrameworkEvent): number | undefined {
  return receivedTimes.get(event)
}
