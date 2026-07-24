import type { Driver, DriverSession } from './driver/index.js'
import { type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import { runAwaitRounds, type BindProjectDeps, type RecordMessage } from './await-gate.js'
import { composeRunSystem, renderSystemPrompt, type EcoOptions, type TfContext } from './system-prompt.js'
import { createRunControls, emitSessionStart, endStopDetail } from './run-telemetry.js'
import { createTurnSignalEmitter } from './turn-gate.js'
import { leaveResumeNote } from './todo-loop.js'
import type { RunMessages } from './run-messages.js'

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
  /** This run has a real browser (#824), so the system channel says so. */
  browser?: boolean
  /**
   * This is a project-less "topic" run (#1120): advertise the bind gate (#1121) in the system
   * channel and wire {@link bind} so an `await-bind-project` / `await-create-project` gate resolves.
   */
  topic?: boolean
  /** The bind seams (#1121) a topic run's gate resolves against. Only meaningful with {@link topic}. */
  bind?: BindProjectDeps
  /** Transparent mode (#625): empty the system channel and pass the prompt verbatim (raw `claude -p`). */
  transparent?: boolean
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
  consumptionGate?: () => string | null
  /** Session link template for the dashboard, `{sessionId}` resolved when known. */
  sessionLink?: string
  /**
   * Live chat (#714): stay open after the prompt settles and take the user's own
   * messages, each resuming the same session. Unset for a headless run, which ends
   * when the agent stops asking — exactly as before.
   */
  messages?: RunMessages
  /** Record each chat turn to the committed conversation (#908). Best-effort; unset = not recorded. */
  recordMessage?: RecordMessage
  /**
   * Resume a finished run's conversation (#720): the captured agent session id to
   * continue. When set, the prompt is sent as a plain continuation message that
   * `--resume`s that session (full prior context), and the built-in system framing
   * is skipped (the resumed transcript already carries it). This is what the
   * dashboard sends when you message a run that has already ended.
   */
  resumeSessionId?: string
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
    // Swallow a listener that throws, as runFramework does: emit runs both inside and outside the
    // try below (the session-start and system-prompt events fire first), so an unguarded throw would
    // escape the run uncaught or skip its `end` event.
    if (opts.onEvent) {
      try {
        opts.onEvent(event)
      } catch (err) {
        console.error('[framework] onEvent threw; ignoring:', err)
      }
    }
  }

  // The built-in #326 prompt + any user SYSTEM.md frame the session (#301). The
  // await protocol is always on — honoring the prompt's gates is the whole point
  // of this path.
  const tf: TfContext = {
    prompt: opts.prompt,
    params: { autopilot: opts.autopilot === true, ...(opts.eco ? { eco: opts.eco } : {}) },
  }
  const system = composeRunSystem({ antiLazyPill: opts.antiLazyPill, browser: opts.browser, topic: opts.topic, transparent: opts.transparent, user: opts.systemPrompt, tf, context: opts.context })
  // The template's `# User prompt` half carries the prompt (today it renders to
  // exactly `opts.prompt`; any framing Rom adds around the slot rides along). With
  // the built-in prompt off (or transparent, #625), the raw prompt is sent as-is.
  // Resuming a finished run (#720) also sends it raw: the `--resume`d transcript already
  // carries the framing, so re-wrapping it would only duplicate the system template.
  const resuming = typeof opts.resumeSessionId === 'string' && opts.resumeSessionId.length > 0
  const firstPrompt = resuming || opts.transparent || opts.antiLazyPill === false ? opts.prompt : renderSystemPrompt(tf).user

  emitSessionStart({ emit, driver: opts.driver, cwd: opts.cwd, sessionLink: opts.sessionLink })
  // Surface the exact system prompt the agent runs under (#343). The user prompts
  // ride along as `driver` `start` events, so the dashboard can show them all.
  emit({ kind: 'system-prompt', text: system })

  // Usage accounting + the self-stops, the same wiring as a build run (#322/#529):
  // the run signal composes the caller's abort with the budget/consumption aborts.
  // (The decline controller is inert here — this path finishes a declined plan cleanly.)
  const { runSignal, onDriverEvent, consumptionTrip, budgetController, consumptionController, declineController } =
    createRunControls({
      emit,
      signal: opts.signal,
      sessionLink: opts.sessionLink,
      budgetUsd: opts.budgetUsd,
      consumptionGate: opts.consumptionGate,
    })

  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    ...(resuming ? { resumeSessionId: opts.resumeSessionId } : {}),
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
      emitTurnSignals,
      requestChoice: opts.requestChoice,
      emit,
      signal: runSignal,
      ...(opts.bind ? { bind: opts.bind } : {}),
      ...(resuming ? { resume: true } : {}),
      ...(opts.messages ? { messages: opts.messages } : {}),
      ...(opts.recordMessage ? { recordMessage: opts.recordMessage } : {}),
    })
    // The agent kept asking past the limit: finish with the latest turn rather than loop.
    if (rounds.exhausted) emit({ kind: 'log', message: 'Finishing the session (await limit reached).' })
    emit({ kind: 'end', ok: true })
    return { text: rounds.text, events }
  } catch (err) {
    const { stopped, detail } = await endStopDetail({
      err,
      ...(opts.signal ? { signal: opts.signal } : {}),
      budgetController,
      consumptionController,
      declineController,
      consumptionTrip,
      ...(opts.budgetUsd != null ? { budgetUsd: opts.budgetUsd } : {}),
      leaveResumeNote: () => leaveResumeNote(opts.cwd, events, emit),
    })
    emit({ kind: 'end', ok: false, ...(stopped ? { stopped: true } : {}), detail })
    throw err
  } finally {
    await session.dispose()
  }
}
