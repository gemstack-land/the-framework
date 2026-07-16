import type { Driver, DriverSession } from './driver/index.js'
import { type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import { runAwaitRounds } from './run.js'
import { composeRunSystem, renderSystemPrompt, type EcoOptions, type TfContext } from './system-prompt.js'
import { createDriverEventHandler, emitSessionStart } from './run-telemetry.js'
import { createTurnSignalEmitter } from './turn-gate.js'
import { CONSUMPTION_LIMIT_LABEL, type ConsumptionWindow } from './consumption.js'
import { leaveResumeNote } from './todo-loop.js'

/**
 * The direct prompt path (#331): run *one prompt* through the driver and honor
 * its await gates — no scope/build scaffolding, no review loop. This
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
  /** In-context directories (#439): added as one `Context:` line to the system prompt. */
  context?: readonly string[]
  /** Stop the run once the agent has spent this much, in USD (#322). */
  budgetUsd?: number
  /**
   * Consult the consumption limits between turns (#531): return the limit that
   * has been reached to pause the run, or `null` to carry on. Same seam and same
   * fail-open as a build run — see `RunFrameworkOptions.consumptionGate`.
   */
  consumptionGate?: () => ConsumptionWindow | null
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
  const system = composeRunSystem({ antiLazyPill: opts.antiLazyPill, user: opts.systemPrompt, tf, context: opts.context })
  // The template's `# User prompt` half carries the prompt (today it renders to
  // exactly `opts.prompt`; any framing Rom adds around the slot rides along). With
  // the built-in prompt off, the raw prompt is sent as-is.
  const firstPrompt = opts.antiLazyPill === false ? opts.prompt : renderSystemPrompt(tf).user

  emitSessionStart({ emit, driver: opts.driver, cwd: opts.cwd, sessionLink: opts.sessionLink })
  // Surface the exact system prompt the agent runs under (#343). The user prompts
  // ride along as `driver` `start` events, so the dashboard can show them all.
  emit({ kind: 'system-prompt', text: system })

  // Usage accounting + the self-stopping budget cap, the same wiring as a build
  // run (#322): the run signal composes the caller's abort with the budget abort.
  const budgetController = new AbortController()
  // A consumption limit (#531) is the other self-stop: the account's quota ran
  // out rather than this run's spend.
  const consumptionController = new AbortController()
  const runSignal = AbortSignal.any([
    ...(opts.signal ? [opts.signal] : []),
    budgetController.signal,
    consumptionController.signal,
  ])
  const { onDriverEvent, consumptionTrip } = createDriverEventHandler({
    emit,
    sessionLink: opts.sessionLink,
    budgetUsd: opts.budgetUsd,
    consumptionGate: opts.consumptionGate,
    budgetController,
    consumptionController,
  })

  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    signal: runSignal,
    onEvent: onDriverEvent,
  })

  // Non-blocking signals the agent emitted this turn: markdown views (#441) and the #326
  // lifecycle signals (session name, ready-for-merge). None stop the turn.
  const emitTurnSignals = createTurnSignalEmitter(emit)

  try {
    // A declined plan (#358) ends the run cleanly: the user takes over with fresh instructions.
    const rounds = await runAwaitRounds({
      session,
      prompt: firstPrompt,
      continuation: (gate, answer) =>
        `You paused to ask: "${gate.title}". The user chose: ${answer}. Continue with that decision, and do not ask again unless a genuinely new choice comes up.`,
      emitTurnSignals,
      requestChoice: opts.requestChoice,
      emit,
      signal: runSignal,
    })
    // The agent kept asking past the limit: finish with the latest turn rather than loop.
    if (rounds.exhausted) emit({ kind: 'log', message: 'Finishing the run (await limit reached).' })
    emit({ kind: 'end', ok: true })
    return { text: rounds.text, events }
  } catch (err) {
    // A user interrupt or the budget cap is a clean stop, not a failure (#322).
    const budgetStopped = budgetController.signal.aborted && opts.signal?.aborted !== true
    const paused = consumptionController.signal.aborted && opts.signal?.aborted !== true
    const stopped = opts.signal?.aborted === true || budgetController.signal.aborted || consumptionController.signal.aborted
    // Written here, not at the trip: the note is file I/O and the trip is a sync
    // event handler, so a fire-and-forget write could lose the race with the run
    // unwinding.
    const resumeNote = paused ? await leaveResumeNote(opts.cwd, events, emit) : undefined
    const detail = budgetStopped
      ? `budget reached ($${opts.budgetUsd})`
      : paused
        ? `${CONSUMPTION_LIMIT_LABEL[consumptionTrip() ?? 'session']} consumption limit reached${resumeNote ? `; will resume from ${resumeNote}` : ''}`
        : err instanceof Error
          ? err.message
          : String(err)
    emit({ kind: 'end', ok: false, ...(stopped ? { stopped: true } : {}), detail })
    throw err
  } finally {
    await session.dispose()
  }
}
