/**
 * Wrap an engine's optional `onEvent` so progress reporting can never take the run
 * down: a callback that throws is logged and swallowed, and no callback at all is a
 * no-op rather than a branch at every emit site.
 *
 * `what` names the engine in that log line. It is explicit because the call sites
 * genuinely disagreed: bootstrap and overview named themselves, supervisor and loop
 * did not. Passing it in keeps each engine's message exactly as it was, rather than
 * a fourth copy quietly re-labelling two of them.
 */
export function makeEmitter<E>(onEvent: ((event: E) => void) | undefined, what?: string): (event: E) => void {
  if (!onEvent) return () => {}
  const label = what ? `${what} onEvent` : 'onEvent'
  return event => {
    try {
      onEvent(event)
    } catch (err) {
      console.error(`[ai-autopilot] ${label} callback threw; ignoring:`, err)
    }
  }
}
