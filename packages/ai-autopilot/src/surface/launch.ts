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
 *
 * The type params default to the supervisor's `E`/`R` so supervisor surfaces are
 * unchanged; bootstrap emits its own narration events and returns its own result,
 * so it launches with `AutopilotHandle<BootstrapEvent, BootstrapResult>`.
 */
export interface AutopilotHandle<E = SupervisorEvent, R = SupervisorRun> {
  /** Stable id for this run. */
  readonly id: string
  /** Current lifecycle state. */
  status(): AutopilotStatus
  /** Events emitted so far, from `fromOffset` (default 0). */
  events(fromOffset?: number): E[]
  /** A fresh async iterator over events: replays history, then live, then ends. */
  stream(): AsyncIterableIterator<E>
  /** Resolves with the run's result, or rejects if the run threw. */
  result(): Promise<R>
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
export function launchAutopilot<E = SupervisorEvent, R = SupervisorRun>(
  start: (onEvent: (event: E) => void) => Promise<R>,
  opts: LaunchOptions = {},
): AutopilotHandle<E, R> {
  const stream = new EventStream<E>()
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
