import type { Driver, DriverEvent, DriverSession } from './driver/index.js'
import { hasSessionIdPlaceholder, resolveSessionLink, type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import { resolveAwaitGate } from './run.js'
import { renderSystemPrompt, systemPromptBlock, type EcoOptions, type TfContext } from './system-prompt.js'
import { AWAIT_PROTOCOL, PLAN_DECLINED_MESSAGE, isDeclinedConfirmation, parseAwaitGate } from './turn-gate.js'
import { UsageMeter } from './usage.js'

/**
 * The direct prompt path (#331): run *one prompt* through the driver and honor
 * its await gates — no scope/architect/build scaffolding, no review loop. This
 * is what a review-shaped preset like [Research] needs: the prompt operates on
 * existing code, stops at `showChoices()` / `showMultiSelect()` + AWAIT, and
 * continues from the user's answer. Plumbing, not babysitting — the framework
 * adds nothing but the gate protocol and the usage/budget accounting.
 */

/** Options for {@link runPrompt}. */
export interface RunPromptOptions {
  /** The fully rendered prompt to run (see e.g. `renderResearchPrompt`). */
  prompt: string
  /** The driver wrapping the coding agent. */
  driver: Driver
  /** Workspace the agent works in. */
  cwd: string
  /** Receives every {@link FrameworkEvent} as it happens (dashboard, terminal, store). */
  onEvent?: (event: FrameworkEvent) => void
  /**
   * The interactive gate handler, exactly as in `RunFrameworkOptions` (#304).
   * Unlike a build run, a *headless* direct run still resolves each gate to its
   * defaults and continues — the prompt's post-gate steps must run either way.
   */
  requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
  /** Abort to stop the run (Stop button / Ctrl+C / control channel). */
  signal?: AbortSignal
  /** Model override passed through to the driver. */
  model?: string
  /** A user SYSTEM.md to append to the built-in system prompt (#301). */
  systemPrompt?: string
  /** Include the built-in #326 system prompt. Default true (#301; the name is the historical config key). */
  antiLazyPill?: boolean
  /** Whether autopilot mode is on: steers the #326 prompt's maintenance stance (#325). Default false. */
  autopilot?: boolean
  /** Eco fine-grained control (#314): drop the enabled #326 sections to save tokens. */
  eco?: EcoOptions
  /** Stop the run once the agent has spent this much, in USD (#322). */
  budgetUsd?: number
  /** Session link template for the dashboard, `{sessionId}` resolved when known. */
  sessionLink?: string
}

/** What {@link runPrompt} resolves with. */
export interface RunPromptResult {
  /** The final turn's text. */
  text: string
  /** Every event emitted, in order. */
  events: FrameworkEvent[]
}

/** How many times the prompt may stop to ask (and be resumed) before it just finishes. */
const MAX_AWAIT_ROUNDS = 5

/**
 * Run one prompt to completion through the driver, pausing on each await gate
 * (#337/#339) and re-prompting with the user's answer. Emits the same
 * {@link FrameworkEvent} stream a build run does (`session`, `driver`, `choice`,
 * `usage`, `end`), so the dashboard, the store, and the control channel (#344)
 * all work unchanged.
 */
export async function runPrompt(opts: RunPromptOptions): Promise<RunPromptResult> {
  const events: FrameworkEvent[] = []
  const emit = (event: FrameworkEvent): void => {
    events.push(event)
    opts.onEvent?.(event)
  }

  // The built-in #326 prompt + any user SYSTEM.md frame the session (#301). The
  // await protocol is always on — honoring the prompt's gates is the whole point
  // of this path.
  const tf: TfContext = {
    prompt: opts.prompt,
    params: { autopilot: opts.autopilot === true, ...(opts.eco ? { eco: opts.eco } : {}) },
  }
  const promptBlock = systemPromptBlock({ antiLazyPill: opts.antiLazyPill, user: opts.systemPrompt, tf })
  const system = [...(promptBlock ? [promptBlock] : []), AWAIT_PROTOCOL].join('\n\n')
  // The template's `# User prompt` half carries the prompt (today it renders to
  // exactly `opts.prompt`; any framing Rom adds around the slot rides along). With
  // the built-in prompt off, the raw prompt is sent as-is.
  const firstPrompt = opts.antiLazyPill === false ? opts.prompt : renderSystemPrompt(tf).user

  const linkTemplate = opts.sessionLink
  const literalLink = linkTemplate && !hasSessionIdPlaceholder(linkTemplate) ? linkTemplate : undefined
  emit({
    kind: 'session',
    driver: opts.driver.name,
    workspace: opts.cwd,
    fake: opts.driver.name === 'fake',
    ...(literalLink ? { sessionLink: literalLink } : {}),
  })
  // Surface the exact system prompt the agent runs under (#343). The user prompts
  // ride along as `driver` `start` events, so the dashboard can show them all.
  emit({ kind: 'system-prompt', text: system })

  // Usage accounting + the self-stopping budget cap, the same wiring as a build
  // run (#322): the run signal composes the caller's abort with the budget abort.
  const budgetController = new AbortController()
  const runSignal = opts.signal ? AbortSignal.any([opts.signal, budgetController.signal]) : budgetController.signal
  let lastSessionId: string | undefined
  const usage = new UsageMeter()
  const onDriverEvent = (event: DriverEvent): void => {
    emit({ kind: 'driver', event })
    if (event.type !== 'result') return
    if (event.sessionId && event.sessionId !== lastSessionId) {
      lastSessionId = event.sessionId
      const link = linkTemplate ? resolveSessionLink(linkTemplate, event.sessionId) : undefined
      emit({ kind: 'session-update', sessionId: event.sessionId, ...(link ? { sessionLink: link } : {}) })
    }
    if (!event.usage) return
    usage.add(event.usage)
    const totals = usage.totals()
    emit({ kind: 'usage', ...totals, ...(opts.budgetUsd != null ? { budgetUsd: opts.budgetUsd } : {}) })
    if (opts.budgetUsd != null && totals.costUsd >= opts.budgetUsd && !budgetController.signal.aborted) {
      emit({ kind: 'log', message: `Budget reached: $${totals.costUsd.toFixed(4)} of $${opts.budgetUsd} — stopping the run.` })
      budgetController.abort(new Error('[framework] budget reached'))
    }
  }

  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    signal: runSignal,
    onEvent: onDriverEvent,
  })

  try {
    let turn = await session.prompt(firstPrompt, { signal: runSignal })
    let gate = parseAwaitGate(turn.text)
    for (let round = 0; round < MAX_AWAIT_ROUNDS && gate; round++) {
      const answer = await resolveAwaitGate(gate, round, { requestChoice: opts.requestChoice, emit, signal: runSignal })
      if (isDeclinedConfirmation(gate, answer)) {
        // A declined plan (#358) ends the run cleanly: the user takes over with fresh instructions.
        emit({ kind: 'log', message: PLAN_DECLINED_MESSAGE })
        gate = undefined
        break
      }
      emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
      turn = await session.prompt(
        `You paused to ask: "${gate.title}". The user chose: ${answer}. Continue with that decision, and do not ask again unless a genuinely new choice comes up.`,
        { signal: runSignal },
      )
      gate = parseAwaitGate(turn.text)
    }
    // The agent kept asking past the limit: finish with the latest turn rather than loop.
    if (gate) emit({ kind: 'log', message: 'Finishing the run (await limit reached).' })
    emit({ kind: 'end', ok: true })
    return { text: turn.text, events }
  } catch (err) {
    // A user interrupt or the budget cap is a clean stop, not a failure (#322).
    const budgetStopped = budgetController.signal.aborted && opts.signal?.aborted !== true
    const stopped = opts.signal?.aborted === true || budgetController.signal.aborted
    const detail = budgetStopped ? `budget reached ($${opts.budgetUsd})` : err instanceof Error ? err.message : String(err)
    emit({ kind: 'end', ok: false, ...(stopped ? { stopped: true } : {}), detail })
    throw err
  } finally {
    await session.dispose()
  }
}
