import type { SupervisorEvent } from '../types.js'

/**
 * A replayable, multi-consumer stream of {@link SupervisorEvent}s. It is the
 * transport shared by the in-page and background surfaces: buffer every event,
 * hand out live async iterators, and replay history from an offset (borrowing
 * Flue's Durable-Streams `tail=N`). The terminal surface uses {@link terminalSink}
 * directly and does not need this.
 */
export class EventStream {
  private readonly buffer: SupervisorEvent[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false

  /** Append an event. Wire this in as a Supervisor `onEvent`. Ignored once closed. */
  readonly push = (event: SupervisorEvent): void => {
    if (this.closed) return
    this.buffer.push(event)
    for (const wake of this.waiters.splice(0)) wake()
  }

  /** Alias for {@link push}, reads well at the `onEvent:` call site. */
  get sink(): (event: SupervisorEvent) => void {
    return this.push
  }

  /** Events buffered so far, from `fromOffset` (default 0) — Flue-style tail replay. */
  history(fromOffset = 0): SupervisorEvent[] {
    return this.buffer.slice(fromOffset)
  }

  /** Number of events buffered. */
  get length(): number {
    return this.buffer.length
  }

  /** True once {@link close} has run. */
  get isClosed(): boolean {
    return this.closed
  }

  /** End the stream: live iterators drain their backlog, then finish. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const wake of this.waiters.splice(0)) wake()
  }

  /**
   * A fresh async iterator that replays every buffered event, then yields new
   * ones as they arrive, and finishes once the stream is closed and drained.
   * Independent iterators each keep their own cursor, so late consumers still
   * see the full history.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<SupervisorEvent> {
    let index = 0
    const stream = this
    return {
      [Symbol.asyncIterator]() {
        return this
      },
      next(): Promise<IteratorResult<SupervisorEvent>> {
        if (index < stream.buffer.length) {
          return Promise.resolve({ value: stream.buffer[index++]!, done: false })
        }
        if (stream.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise(resolve => {
          stream.waiters.push(() => {
            if (index < stream.buffer.length) resolve({ value: stream.buffer[index++]!, done: false })
            else resolve({ value: undefined, done: true })
          })
        })
      },
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Render a {@link SupervisorEvent} as a single human-readable line. */
export function formatEvent(event: SupervisorEvent): string {
  switch (event.type) {
    case 'plan':
      return `▶ plan: ${event.subtasks.length} subtask(s) for "${event.task}"`
    case 'plan-trimmed':
      return `  plan trimmed: kept ${event.kept}, dropped ${event.dropped} (${event.reason})`
    case 'dispatch-start':
      return `  → ${event.subtask.id}: ${event.subtask.description}`
    case 'dispatch-result':
      return event.result.ok
        ? `  ✓ ${event.result.subtask.id}`
        : `  ✗ ${event.result.subtask.id} (${errorText(event.result.error)})`
    case 'budget-exceeded':
      return `  ! budget exceeded: ${event.spentTokens}/${event.limitTokens} tokens, ${event.skipped} skipped`
    case 'synthesize':
      return `▶ synthesize: ${event.results.length} result(s)`
  }
}

/** Options for {@link terminalSink}. */
export interface TerminalSinkOptions {
  /** Where to write each formatted line. Default: `process.stdout` (with a newline). */
  write?: (line: string) => void
}

/**
 * The terminal surface: an `onEvent` sink that prints each event as a formatted
 * line. Pass it as a Supervisor `onEvent` and run inline.
 *
 * ```ts
 * const supervisor = new Supervisor({ ...opts, onEvent: terminalSink() })
 * await supervisor.run(task)
 * ```
 */
export function terminalSink(opts: TerminalSinkOptions = {}): (event: SupervisorEvent) => void {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'))
  return event => write(formatEvent(event))
}
