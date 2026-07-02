import type { SupervisorEvent, SupervisorRun } from '../types.js'
import { EventStream } from './events.js'

/** The lifecycle state of a launched autopilot run. */
export type AutopilotStatus = 'running' | 'done' | 'error'

/**
 * A handle to a running autopilot, detached from the caller's control flow —
 * the background surface. Poll {@link status}, replay {@link events} from an
 * offset, subscribe to the live {@link stream}, or await the final
 * {@link result}. The same handle backs an in-page surface (iterate `stream()`
 * and push each event over SSE) and a background process (persist the handle,
 * let a client poll `status()` + `events(offset)`).
 */
export interface AutopilotHandle {
  /** Stable id for this run. */
  readonly id: string
  /** Current lifecycle state. */
  status(): AutopilotStatus
  /** Events emitted so far, from `fromOffset` (default 0). */
  events(fromOffset?: number): SupervisorEvent[]
  /** A fresh async iterator over events: replays history, then live, then ends. */
  stream(): AsyncIterableIterator<SupervisorEvent>
  /** Resolves with the run's result, or rejects if the run threw. */
  result(): Promise<SupervisorRun>
}

/** Options for {@link launchAutopilot}. */
export interface LaunchOptions {
  /** Override the generated run id. */
  id?: string
}

let counter = 0

/**
 * Launch an autopilot run in the background and return a {@link AutopilotHandle}
 * without blocking. `start` receives an `onEvent` sink and returns the run's
 * promise — typically `onEvent => new Supervisor({ ...opts, onEvent }).run(task)`.
 * Keeping `start` caller-provided means this surface knows nothing about how the
 * Supervisor is built; it only owns the event stream and lifecycle.
 */
export function launchAutopilot(
  start: (onEvent: (event: SupervisorEvent) => void) => Promise<SupervisorRun>,
  opts: LaunchOptions = {},
): AutopilotHandle {
  const stream = new EventStream()
  const id = opts.id ?? `autopilot-${++counter}`
  let state: AutopilotStatus = 'running'

  const result = start(stream.sink)
    .then(run => {
      state = 'done'
      return run
    })
    .catch((err: unknown) => {
      state = 'error'
      throw err
    })
    .finally(() => stream.close())

  // Keep an unconsumed rejection from surfacing as an unhandled rejection;
  // callers still observe it through result().
  result.catch(() => {})

  return {
    id,
    status: () => state,
    events: fromOffset => stream.history(fromOffset),
    stream: () => stream[Symbol.asyncIterator](),
    result: () => result,
  }
}
