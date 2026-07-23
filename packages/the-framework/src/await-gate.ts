import {
  BROWSER_HANDLED,
  BROWSER_NOT_HANDLED,
  CONFIRM_APPROVED,
  CONFIRM_DECLINED,
  MAX_AWAIT_ROUNDS,
  PLAN_DECLINED_MESSAGE,
  continuationPrompt,
  isDeclinedConfirmation,
  parseAwaitGate,
  type ParsedAwaitGate,
} from './turn-gate.js'
import { pickedIds, type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import type { DriverSession, DriverTurn } from './driver/index.js'
import type { RunMessages } from './run-messages.js'

// The shared await/choice/chat machinery (#304/#337/#339/#714), lifted out of the run
// lifecycle so the build path (run.ts), the direct prompt path (prompt-run.ts), and the
// backlog loop (todo-loop.ts) can all reach it without importing the orchestrator — which is
// what removed the run <-> todo-loop cycle. run.ts composes these primitives into a lifecycle;
// it does not own them.

/**
 * Resolve one parsed await gate (#337/#339) to the user's answer text, ready to
 * seed the continuation prompt: emits the `choice`, parks for the pick (or the
 * headless/abort fallback), and maps the picked id(s) back to label(s). Round 0
 * keeps a stable gate id; later rounds get a unique one so a dashboard never
 * confuses a re-ask with the answer it just resolved. Shared by the build's
 * `agentAwaitGate`, the direct prompt path, and the backlog loop (#323).
 */
export async function resolveAwaitGate(
  gate: ParsedAwaitGate,
  round: number,
  deps: {
    requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
    emit: (event: FrameworkEvent) => void
    signal?: AbortSignal | undefined
  },
): Promise<string> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  const choiceOpt = deps.requestChoice ? { requestChoice: deps.requestChoice } : {}
  const baseId =
    gate.kind === 'multi'
      ? 'await-multiselect'
      : gate.kind === 'confirm'
        ? 'await-confirmation'
        : gate.kind === 'browser'
          ? 'await-browser'
          : 'await-choices'
  const id = round === 0 ? baseId : `${baseId}-${round}`
  if (gate.kind === 'browser') {
    // The agent is stuck on a page and needs a human to act on it (#796). Rides the same
    // choice plumbing as every other gate, so the CLI and the dashboard render it today.
    //
    // Recommended is "could not handle it" — the opposite of the confirmation gate's default.
    // A headless run has nobody at the browser, and telling the agent a human cleared the
    // login wall when none did sends it back to a page that is still blocked.
    const picked = await requestChoices({
      id,
      title: gate.url ? `${gate.title} (${gate.url})` : gate.title,
      options: [
        { id: 'handled', label: BROWSER_HANDLED },
        { id: 'not-handled', label: BROWSER_NOT_HANDLED },
      ],
      recommended: 'not-handled',
      confirm: true,
      emit: deps.emit,
      ...choiceOpt,
      ...signalOpt,
    })
    return picked === 'handled' ? BROWSER_HANDLED : BROWSER_NOT_HANDLED
  }
  if (gate.kind === 'confirm') {
    // The plan-approval confirmation (#358): a fixed Approve / Decline pair, recommended
    // Approve so a headless (or aborted) run proceeds — the same semantics as the other gates.
    const picked = await requestChoices({
      id,
      title: gate.title,
      options: [
        { id: 'approve', label: CONFIRM_APPROVED },
        { id: 'decline', label: CONFIRM_DECLINED },
      ],
      recommended: 'approve',
      confirm: true,
      ...(gate.file ? { file: gate.file } : {}),
      emit: deps.emit,
      ...choiceOpt,
      ...signalOpt,
    })
    return picked === 'decline' ? CONFIRM_DECLINED : CONFIRM_APPROVED
  }
  if (gate.kind === 'multi') {
    const picked = await requestMultiSelect({ id, title: gate.title, options: gate.options, emit: deps.emit, ...choiceOpt, ...signalOpt })
    const labels = gate.options.filter(o => picked.includes(o.id)).map(o => o.label)
    return labels.length ? labels.join(', ') : '(none)'
  }
  const pickedId = await requestChoices({
    id,
    title: gate.title,
    options: gate.options,
    ...(gate.recommended ? { recommended: gate.recommended } : {}),
    emit: deps.emit,
    ...choiceOpt,
    ...signalOpt,
  })
  return gate.options.find(o => o.id === pickedId)?.label ?? pickedId
}

/** What {@link runAwaitRounds} hands back. */
export interface AwaitRoundsResult {
  /** The last turn's text. */
  text: string
  /** A confirmation gate was declined (#358): the caller stops rather than build on it. */
  declined: boolean
  /** The agent was still asking when the round cap ran out. */
  exhausted: boolean
}

/** Inputs to {@link runAwaitRounds}. */
export interface AwaitRoundsOptions {
  session: DriverSession
  /** The prompt that opens the exchange. */
  prompt: string
  /** Emit the signals each turn carries (#563). */
  emitTurnSignals: (text: string) => void
  requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
  emit: (event: FrameworkEvent) => void
  signal?: AbortSignal | undefined
  /**
   * Live chat (#714): once the agent stops asking, stay open for the user's own
   * messages, each resuming the same session. Unset for a headless run, which then
   * ends when the agent stops asking — byte-identical to before this existed.
   */
  messages?: RunMessages | undefined
  /**
   * Resume a prior session on the OPENING prompt (#720): when the driver session was
   * seeded with a finished run's id, this makes the first message `--resume` that
   * conversation (full prior context) instead of starting fresh. Default off.
   */
  resume?: boolean | undefined
  /**
   * Record a chat turn to the committed conversation (#908). Best-effort and fire-and-forget:
   * persisting must never stall or fail a run. Unset for a headless run, which has no chat.
   */
  recordMessage?: RecordMessage | undefined
}

/**
 * Persist one chat turn. See {@link AwaitRoundsOptions.recordMessage}.
 *
 * `via` names the surface the turn happened on (#917). Omitted, the recorder falls back to the
 * run's own surface, which is what every turn did before a message could arrive from elsewhere.
 */
export type RecordMessage = (role: 'user' | 'agent', text: string, via?: string) => void

/** The shared deps of a turn that may hit an await gate or a chat message. */
export interface AwaitTurnDeps {
  requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
  emit: (event: FrameworkEvent) => void
  emitTurnSignals: (text: string) => void
  signal?: AbortSignal | undefined
  recordMessage?: RecordMessage | undefined
}

/**
 * Resolve the await gates (#337/#339) a turn ended on: pick the answer, continue with
 * it, repeat until the agent stops asking or the {@link MAX_AWAIT_ROUNDS} cap trips. A
 * declined plan (#358) stops here. Returns the settled turn plus whether it declined /
 * was still asking at the cap.
 *
 * Every path that runs gates shares this loop: the opening prompt, each chat message, and
 * the build's `agentAwaitGate`. They differ only in how a turn is continued — a raw
 * `session.prompt`, or a supervisor pass that carries a `SupervisorRun` — which is what
 * `continueWith` is. Keeping one loop is what stopped the per-turn signal emission from
 * having to be added to each copy by hand (#563).
 */
export async function drainGates<T extends { text: string }>(
  turn: T,
  deps: AwaitTurnDeps,
  continueWith: (question: string, answer: string) => Promise<T>,
): Promise<{ turn: T; declined: boolean; exhausted: boolean }> {
  let gate = parseAwaitGate(turn.text)
  for (let round = 0; round < MAX_AWAIT_ROUNDS && gate; round++) {
    const answer = await resolveAwaitGate(gate, round, deps)
    if (isDeclinedConfirmation(gate, answer)) {
      deps.emit({ kind: 'log', message: PLAN_DECLINED_MESSAGE })
      return { turn, declined: true, exhausted: false }
    }
    deps.emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
    turn = await continueWith(gate.title, answer)
    deps.emitTurnSignals(turn.text)
    gate = parseAwaitGate(turn.text)
  }
  return { turn, declined: false, exhausted: gate !== undefined }
}

/** Continue a plain driver session from a gate answer: the raw-prompt half of {@link drainGates}. */
function promptContinuation(session: DriverSession, deps: AwaitTurnDeps): (question: string, answer: string) => Promise<DriverTurn> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  return (question, answer) => session.prompt(continuationPrompt(question, answer), signalOpt)
}

/**
 * The live-chat loop (#714): wait for the user's next message, deliver it by resuming the
 * same session (full conversational context), then honor any await gate it produced —
 * repeat until the source resolves `undefined` (Stop / budget cap). This is the "stay-open"
 * lifecycle: a run keeps running as a conversation until the user ends it. Shared by the
 * direct prompt path and the build path, which both reach it once their work has settled.
 *
 * Reports the settled `exhausted` of the *last* chat turn (#742): entering chat means the
 * opening prompt's await-round cap is no longer the run's end reason, and a phase that ends
 * on Stop / close is not exhausted at all.
 */
export async function runChatPhase(session: DriverSession, messages: RunMessages, seed: DriverTurn, deps: AwaitTurnDeps): Promise<{ turn: DriverTurn; exhausted: boolean }> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  let turn = seed
  let exhausted = false
  for (;;) {
    // Parked on the user (#785): the work is settled and nothing is running until a message
    // arrives. Said out loud each time round, so a reader can tell waiting from working.
    deps.emit({ kind: 'settled' })
    const message = await messages.next(deps.signal)
    if (message === undefined) return { turn, exhausted } // Stop / budget cap: end the conversation.
    // The message shows in the feed as the driver's own `start` event (the YOU row), so it is not
    // echoed as a separate log line — that only duplicated it.
    deps.recordMessage?.('user', message.text, message.via)
    turn = await session.prompt(message.text, { ...signalOpt, resume: true })
    deps.emitTurnSignals(turn.text)
    const drained = await drainGates(turn, deps, promptContinuation(session, deps))
    turn = drained.turn
    exhausted = drained.exhausted
    // The settled text, so the recorded reply is what the user actually read (#908). Attributed to
    // the surface that asked (#917): a reply belongs to the conversation it answers, so a Discord
    // question and its answer read as one exchange rather than two different places.
    deps.recordMessage?.('agent', turn.text, message.via)
    if (drained.declined) return { turn, exhausted }
  }
}

/**
 * Prompt the agent and honor its await gates (#337/#339) until it stops asking: resolve each
 * gate to the user's answer, re-prompt with it, and repeat up to {@link MAX_AWAIT_ROUNDS}.
 * A declined plan (#358) ends the exchange rather than re-prompting. When a live-chat
 * {@link AwaitRoundsOptions.messages} source is wired, the run then stays open for the
 * user's own messages (#714) rather than finishing.
 *
 * Every turn here is a turn like any other, so each one's signals are emitted. That is the
 * point of sharing this: the direct prompt path and the backlog loop each had their own copy
 * of these rounds, and the emission had to be added to each by hand (#563).
 */
export async function runAwaitRounds(opts: AwaitRoundsOptions): Promise<AwaitRoundsResult> {
  const { session, emit, emitTurnSignals, messages } = opts
  const deps: AwaitTurnDeps = {
    requestChoice: opts.requestChoice,
    emit,
    emitTurnSignals,
    signal: opts.signal,
    recordMessage: opts.recordMessage,
  }
  const signalOpt = opts.signal ? { signal: opts.signal } : {}

  // Resuming a finished run (#720): the opening message continues the seeded session, so the
  // agent replies with full prior context. A fresh run leaves `resume` unset — unchanged.
  // The opening exchange opens the conversation too, so it is recorded like any other turn (#908).
  opts.recordMessage?.('user', opts.prompt)
  const opening = await session.prompt(opts.prompt, { ...signalOpt, ...(opts.resume ? { resume: true } : {}) })
  emitTurnSignals(opening.text)
  const drained = await drainGates(opening, deps, promptContinuation(session, deps))
  opts.recordMessage?.('agent', drained.turn.text)
  if (drained.declined) return { text: drained.turn.text, declined: true, exhausted: false }

  // Live chat (#714): stay open for the user's messages until Stop. Headless leaves it unset,
  // so the run ends here exactly as before. Once chat runs, its settled state is the run's end
  // reason, not the opening drain's (#742) — otherwise a chat closed by Stop would still be
  // reported "exhausted" and log a spurious await-limit notice.
  if (messages) {
    const chat = await runChatPhase(session, messages, drained.turn, deps)
    return { text: chat.turn.text, declined: false, exhausted: chat.exhausted }
  }
  return { text: drained.turn.text, declined: false, exhausted: drained.exhausted }
}

/** The recommended fallback pick when a single-select gate cannot get a real answer. */
const PROCEED: ChoicePick = { picked: 'proceed', by: 'auto' }

/**
 * Resolve with the human's pick, or fall back to `fallback` if the pick rejects or
 * the run aborts first (user stop / budget cap #322) — so a gate parked for input
 * never hangs. Never rejects. Cleans up its abort listener either way. The fallback
 * is the single-select `proceed` by default; a multi-select passes its default set.
 */
function raceChoiceOrAbort(
  pick: Promise<ChoicePick>,
  signal?: AbortSignal,
  fallback: ChoicePick = PROCEED,
): Promise<ChoicePick> {
  if (!signal) return pick.catch(() => fallback)
  if (signal.aborted) return Promise.resolve(fallback)
  return new Promise<ChoicePick>(resolve => {
    const onAbort = () => resolve(fallback)
    signal.addEventListener('abort', onAbort, { once: true })
    const done = (value: ChoicePick) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    pick.then(done, () => done(fallback))
  })
}

/** One option of a {@link requestChoices} single-select gate (#304). */
export interface ChoicesOption {
  /** Stable id returned when this option is picked. */
  id: string
  /** The label shown next to the option. */
  label: string
  /** Optional one-line detail under the label. */
  detail?: string
}

/** Inputs to {@link requestChoices}. */
export interface ChoicesDeps {
  /** Stable id for the gate; the pick is posted back against it. */
  id: string
  /** The prompt shown above the options. */
  title: string
  /** The options to choose between (pick one). */
  options: readonly ChoicesOption[]
  /** The option id pre-selected (autopilot auto-accepts it) and used as the headless/abort fallback. Default = the first option. */
  recommended?: string
  /** Render as an Approve/Decline confirmation (#358): buttons instead of an option list. */
  confirm?: boolean
  /** The markdown file under approval; the dashboard's doc sidebar renders it. */
  file?: string
  /** The interactive handler (the CLI wires it to the dashboard); omit for a headless run. */
  requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
  /** Emit the `choice` / `choice-resolved` events onto the run stream. */
  emit: (event: FrameworkEvent) => void
  /** The run signal; a gate parked for a pick unblocks (to the recommended option) if the run aborts. */
  signal?: AbortSignal
}

/**
 * The single-select gate (#304): show the options with the recommended one
 * pre-selected, pause, and resolve to the *one* option id the user picked. The twin
 * of {@link requestMultiSelect} for "pick one" — the agent-facing `showChoices()`
 * from the #326 system prompt and the [Research] preset (#331) both build on it.
 * A headless run (no `requestChoice`), or one aborted mid-await, falls back to the
 * recommended option without hanging, so a programmatic run stays deterministic.
 */
export async function requestChoices(deps: ChoicesDeps): Promise<string> {
  const { options, requestChoice, emit } = deps
  const recommended = deps.recommended ?? options[0]?.id ?? ''
  const req: ChoiceRequest = {
    id: deps.id,
    title: deps.title,
    options: options.map(o => ({ id: o.id, label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    ...(recommended ? { recommended } : {}),
    ...(deps.confirm ? { confirm: true } : {}),
    ...(deps.file ? { file: deps.file } : {}),
  }
  emit({ kind: 'choice', ...req })

  const validIds = new Set(options.map(o => o.id))
  const fallback: ChoicePick = { picked: recommended, by: 'auto' }
  // Headless: no one to ask, so accept the recommended option.
  const pick = requestChoice
    ? await raceChoiceOrAbort(requestChoice(req), deps.signal, fallback)
    : fallback
  const picked = pickedIds(pick.picked)[0] ?? ''
  const resolved = validIds.has(picked) ? picked : recommended
  emit({ kind: 'choice-resolved', id: req.id, picked: resolved, by: pick.by ?? 'user' })
  return resolved
}

/** One option of a {@link requestMultiSelect} checklist (#332). */
export interface MultiSelectOption {
  /** Stable id returned when this option is checked. */
  id: string
  /** The label shown next to the checkbox. */
  label: string
  /** Optional one-line detail under the label. */
  detail?: string
  /** Whether this option starts checked (e.g. a low-rated problem in the [Research] preset #331). */
  default?: boolean
}

/** Inputs to {@link requestMultiSelect}. */
export interface MultiSelectDeps {
  /** Stable id for the gate; the pick is posted back against it. */
  id: string
  /** The prompt shown above the checklist. */
  title: string
  /** The options to choose from (checkboxes). */
  options: readonly MultiSelectOption[]
  /** The interactive handler (the CLI wires it to the dashboard); omit for a headless run. */
  requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
  /** Emit the `choice` / `choice-resolved` events onto the run stream. */
  emit: (event: FrameworkEvent) => void
  /** The run signal; a gate parked for a pick unblocks (to the defaults) if the run aborts. */
  signal?: AbortSignal
}

/**
 * The multi-select gate (#332): show a checklist with the default-checked options
 * pre-selected, pause, and resolve to the *subset* of option ids the user kept
 * checked. Built on the same `choice` gate + POST-back resolver as the single-select
 * plan-approval gate (#304), just in checklist mode. A headless run (no
 * `requestChoice`) auto-accepts the default set without pausing, so a programmatic
 * run stays deterministic. This is the primitive the [Research] preset (#331) uses
 * to let the user pick which problems to deep-dive.
 */
export async function requestMultiSelect(deps: MultiSelectDeps): Promise<string[]> {
  const { options, requestChoice, emit } = deps
  const defaults = options.filter(o => o.default).map(o => o.id)
  const req: ChoiceRequest = {
    id: deps.id,
    title: deps.title,
    multi: true,
    options: options.map(o => ({
      id: o.id,
      label: o.label,
      ...(o.detail ? { detail: o.detail } : {}),
      ...(o.default ? { default: true } : {}),
    })),
  }
  emit({ kind: 'choice', ...req })

  const validIds = new Set(options.map(o => o.id))
  const asDefaults: ChoicePick = { picked: defaults, by: 'auto' }
  // Headless: no one to ask, so accept the defaults (the recommended set).
  const pick = requestChoice
    ? await raceChoiceOrAbort(requestChoice(req), deps.signal, asDefaults)
    : asDefaults
  const selected = pickedIds(pick.picked).filter(id => validIds.has(id))
  emit({ kind: 'choice-resolved', id: req.id, picked: selected, by: pick.by ?? 'user' })
  return selected
}
