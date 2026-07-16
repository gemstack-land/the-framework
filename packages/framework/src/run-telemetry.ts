import { CONSUMPTION_LIMIT_LABEL, type ConsumptionWindow } from './consumption.js'
import type { Driver, DriverEvent } from './driver/index.js'
import { hasSessionIdPlaceholder, resolveSessionLink, type FrameworkEvent } from './events.js'
import { UsageMeter } from './usage.js'

// The telemetry both entry paths share. A build (`run.ts`) and a direct prompt
// (`prompt-run.ts`) differ in what they *do* with the agent, but the accounting around
// it is the same: name the session, follow the driver's event stream, total the usage,
// and stop the run when it has spent too much (#322) or the account's quota ran out
// (#529). This lived twice, byte-identical, which is how the backlog loop ended up
// without a copy of the sibling turn-signal parsing at all (#563).

/** Inputs to {@link emitSessionStart}. */
export interface SessionStartOptions {
  emit: (event: FrameworkEvent) => void
  driver: Driver
  /** The workspace the run works in. */
  cwd: string
  /** The session link, literal or templated with `{sessionId}`. */
  sessionLink?: string | undefined
}

/**
 * Emit the run's opening `session` event. A literal link is shown right away; a
 * templated one (`.../{sessionId}`) can only resolve once the driver reports its
 * session id, so it waits for the `session-update` from {@link createDriverEventHandler}.
 */
export function emitSessionStart(opts: SessionStartOptions): void {
  const literal = opts.sessionLink && !hasSessionIdPlaceholder(opts.sessionLink) ? opts.sessionLink : undefined
  opts.emit({
    kind: 'session',
    driver: opts.driver.name,
    workspace: opts.cwd,
    fake: opts.driver.name === 'fake',
    ...(literal ? { sessionLink: literal } : {}),
  })
}

/** Inputs to {@link createDriverEventHandler}. */
export interface DriverEventHandlerOptions {
  emit: (event: FrameworkEvent) => void
  /** The session link template, when the caller configured one. */
  sessionLink?: string | undefined
  /** The run's spend cap (#322). Omitted = uncapped. */
  budgetUsd?: number | undefined
  /** Answers "has the account's quota run out?" between turns (#529). */
  consumptionGate?: (() => ConsumptionWindow | null) | undefined
  /** Tripped when the budget cap is crossed. */
  budgetController: AbortController
  /** Tripped when the consumption gate reports a window is spent. */
  consumptionController: AbortController
}

/** What {@link createDriverEventHandler} hands back. */
export interface DriverEventHandler {
  /** Wire this as the driver session's `onEvent`. */
  onDriverEvent: (event: DriverEvent) => void
  /** The window whose limit tripped, once the consumption gate has fired. */
  consumptionTrip: () => ConsumptionWindow | undefined
}

/**
 * Watch the driver's black box (#165) and turn it into the run's stream: surface the
 * real session id as `session-update` once known (that is the honest handle a UI links
 * to, and it changes per prompt, so re-emit), fold each turn's usage into the run total,
 * and trip the two self-stops.
 *
 * Both stops fire *after* the turn that crossed them: its cost is already spent, so the
 * point is to stop the next one. Each is signalled once, and the run's `AbortSignal.any`
 * composition carries it downstream. An agent that reports no price leaves `costUsd`
 * undefined and so can never trip the budget cap (#540). A consumption gate that throws
 * is treated as "carry on": an unreadable quota must not stop the work (#519), and the
 * gate is answered from a cached reading because a live one spawns the agent CLI (~5s).
 */
export function createDriverEventHandler(opts: DriverEventHandlerOptions): DriverEventHandler {
  const { emit, budgetController, consumptionController } = opts
  let lastSessionId: string | undefined
  let consumptionTrip: ConsumptionWindow | undefined
  const usage = new UsageMeter()

  const onDriverEvent = (event: DriverEvent): void => {
    emit({ kind: 'driver', event })
    if (event.type !== 'result') return
    if (event.sessionId && event.sessionId !== lastSessionId) {
      lastSessionId = event.sessionId
      const link = opts.sessionLink ? resolveSessionLink(opts.sessionLink, event.sessionId) : undefined
      emit({ kind: 'session-update', sessionId: event.sessionId, ...(link ? { sessionLink: link } : {}) })
    }
    if (!event.usage) return
    usage.add(event.usage)
    const totals = usage.totals()
    emit({ kind: 'usage', ...totals, ...(opts.budgetUsd != null ? { budgetUsd: opts.budgetUsd } : {}) })
    if (opts.budgetUsd != null && totals.costUsd !== undefined && totals.costUsd >= opts.budgetUsd && !budgetController.signal.aborted) {
      emit({ kind: 'log', message: `Budget reached: $${totals.costUsd.toFixed(4)} of $${opts.budgetUsd} — stopping the run.` })
      budgetController.abort(new Error('[framework] budget reached'))
    }
    if (opts.consumptionGate && !consumptionController.signal.aborted) {
      let reached: ConsumptionWindow | null = null
      try {
        reached = opts.consumptionGate()
      } catch (err) {
        console.error('[framework] consumptionGate threw; carrying on:', err)
      }
      if (reached) {
        consumptionTrip = reached
        emit({ kind: 'log', message: `${CONSUMPTION_LIMIT_LABEL[reached]} consumption limit reached — pausing the run.` })
        consumptionController.abort(new Error('[framework] consumption limit reached'))
      }
    }
  }

  return { onDriverEvent, consumptionTrip: () => consumptionTrip }
}
