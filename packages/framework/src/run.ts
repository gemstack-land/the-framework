import {
  Bootstrap,
  DockerRunner,
  LocalRunner,
  LoopEngine,
  dockerAvailable,
  builtinPresetRegistry,
  mergeChecklists,
  serveCheck,
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapScope,
  type BootstrapSteps,
  type BuildContext,
  type DeployTarget,
  type DomainPreset,
  type FrameworkDetection,
  type FrameworkSignals,
  type LoopPassContext,
  type RunnerSession,
  type SupervisorRun,
  type Verdict,
} from '@gemstack/ai-autopilot'
import { snapshotWorkspace } from './sandbox.js'
import { type ConsumptionWindow } from './consumption.js'
import type { Driver, DriverSession, DriverTurn } from './driver/index.js'
import { composeRunSystem, type EcoOptions, type TfContext } from './system-prompt.js'
import { createRunControls, emitSessionStart, endStopDetail } from './run-telemetry.js'
import { AWAIT_PROTOCOL, CONFIRM_APPROVED, CONFIRM_DECLINED, MAX_AWAIT_ROUNDS, PLAN_DECLINED_MESSAGE, continuationPrompt, createTurnSignalEmitter, isDeclinedConfirmation, parseAwaitGate, type ParsedAwaitGate } from './turn-gate.js'
// Value import from todo-loop.js is a benign cycle: todo-loop.js only calls
// run.js's hoisted function declarations (requestChoices / resolveAwaitGate).
import { leaveResumeNote, runTodoLoop, type TodoLoopResult } from './todo-loop.js'
import { continueAfterChoice, decideDeploy, deployWith, domainLoopChecklist, driverBuild, driverChecklist, driverImprove, driverLoopPrompts } from './steps.js'
import { OPEN_LOOP_MODES, pickedIds, type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import type { RunMessages } from './run-messages.js'

/**
 * The framework's default full-fledged pass budget. Higher than ai-autopilot's
 * base of 3 because a from-scratch build spends its first pass or two just
 * bootstrapping an empty workspace before there is anything to polish (#182).
 */
export const DEFAULT_MAX_PASSES = 5

/** The deploy decision to narrate at the end (plan-only in v1: it does not ship). */
export interface DeployDecision {
  render: 'ssr' | 'ssg' | 'spa'
  target: string
  reason: string
}

/**
 * How to actually boot and serve the generated app so the loop can gate on it
 * *running*, not just on an agent's review. When set, the production-grade
 * checklist also installs, (builds,) starts the app, and fetches it; a failure
 * becomes a blocker the loop hands back to the agent to fix.
 */
export interface ServeConfig {
  /** The command that starts the app (e.g. `npm run dev`). */
  command: string
  /** Install command run first (e.g. `npm install`). */
  install?: string
  /** Build command run after install (e.g. `npm run build`). */
  build?: string
  /** Port the app listens on. Default 3000. */
  port?: number
  /** How long to wait for it to accept connections. Default 15000ms. */
  waitMs?: number
  /** Path to fetch once it is up. Default `/`. */
  healthPath?: string
  /**
   * Keep the app serving after a successful run and hand back an
   * {@link AppPreview} the caller must {@link AppPreview.stop}. Default `false`:
   * the serve gate boots the app only to check it, then tears it down. The CLI
   * sets this so the dashboard can show a live preview link until Ctrl+C.
   */
  keepAlive?: boolean
}

/** Options for {@link runFramework}. */
export interface RunFrameworkOptions {
  /** What the user wants built (the one scope question's answer). */
  intent: string
  /** How much app: a quick prototype (no full-fledged loop) or the full thing. Default `"full"`. */
  scope?: BootstrapScope
  /** The wrapped coding agent. */
  driver: Driver
  /** Absolute workspace path the agent builds in. */
  cwd: string
  /** Model id to pass through to the driver. */
  model?: string
  /** Signals for preset detection (deps/files). Default: none, so the flagship preset wins. */
  signals?: FrameworkSignals
  /**
   * A user-authored system prompt (from `SYSTEM.md`) injected into every prompt
   * (#301). Load with `loadUserSystemPrompt(cwd)`. Composed after the built-in
   * #326 system prompt, so a repo can add its own instructions on top of the default.
   */
  systemPrompt?: string
  /**
   * Inject the built-in #326 system prompt into every prompt (#301). Default
   * `true`; pass `false` (e.g. from `the-framework.yml`) to remove it. The name
   * is the historical config key: #326 is the anti-lazy-pill's (#297) successor.
   */
  antiLazyPill?: boolean
  /** Transparent mode (#625): empty the system channel entirely (raw `claude -p`); overrides antiLazyPill/eco. */
  transparent?: boolean
  /** Eco fine-grained control (#314): drop the enabled #326 sections to save tokens. */
  eco?: EcoOptions
  /** In-context directories (#439): added as one `Context:` line to the system prompt. */
  context?: readonly string[]
  /**
   * A user-picked Open Loop domain preset ({loops, prompts}) to run the build
   * under (#251). Its loops + prompts are materialized into a driver-backed {@link LoopEngine}
   * exposed as {@link RunFrameworkResult.loop}. Load it with `loadDomainPreset` /
   * `softwareDevelopmentPreset` (pass `modes` there to activate variants). Omit
   * for the framework-only run.
   */
  preset?: DomainPreset
  /**
   * The active modes for the run (e.g. `['autopilot']`). Narrated with the
   * {@link preset} (which is expected to be loaded with them already applied),
   * and `autopilot` also steers the #326 system prompt's maintenance stance.
   */
  modes?: readonly string[]
  /**
   * The loop event kind the review phase dispatches (#265) — this is what makes a
   * run a bug fix vs a feature: `bug-fix` fires the preset's bug-fix loop, the
   * default `major-change` fires its major-change loop. Overrides the preset's own
   * `defaultEvent`. A kind the preset has no loop for falls back to the built-in
   * checklist, so a run is never left unreviewed. No-op without a preset.
   */
  buildEvent?: string
  /** Max full-fledged passes. Default {@link DEFAULT_MAX_PASSES} (5). */
  maxPasses?: number
  /** A deploy decision to narrate at the end. Omit to skip the deploy phase. */
  deploy?: DeployDecision
  /**
   * A real {@link DeployTarget} to *execute* the decided plan (e.g.
   * `cloudflareTarget` / `dokployTarget`). Requires {@link deploy}. Omit to only
   * narrate a plan-only decision.
   */
  deployTarget?: DeployTarget
  /**
   * Boot-and-serve verification for the full-fledged loop: when set, the
   * checklist gates on the app actually running, not just an agent review.
   */
  serve?: ServeConfig
  /**
   * Where the {@link serve} verification runs (#229). `"local"` (default) boots the
   * app on the host, adopting the agent's cwd in place. `"docker"` sandboxes it: a
   * throwaway container is booted, the source is copied in fresh before each check
   * (the build still runs on the host in this slice), deps install inside the
   * container, and the app serves on a mapped port — so agent-authored code never
   * installs or runs on the host. Requires a reachable Docker daemon; no-op without
   * {@link serve}.
   */
  sandbox?: 'local' | 'docker'
  /**
   * A pre-provisioned {@link RunnerSession} to run the serve check in, bypassing
   * {@link sandbox} provisioning. Advanced / testing seam — the caller owns its
   * lifecycle is handed to the run (it is disposed with the run). Omit to let
   * {@link sandbox} provision one.
   */
  runner?: RunnerSession
  /**
   * A link to the live agent session, shown on the dashboard. Either a literal
   * URL, or a template with `{sessionId}` (see {@link SESSION_ID_PLACEHOLDER})
   * that resolves once the wrapped agent reports its real id via `session-update`.
   */
  sessionLink?: string
  /** Interrupt the run between phases. */
  signal?: AbortSignal
  /**
   * Pause the run on an interactive choice and await a pick (#304). Called when a
   * build turn stops to ask (#337/#358): the run emits a `choice` event, calls
   * this, and resumes on the returned option. Omit for a headless run: the gate
   * then auto-accepts the recommended option without pausing. The CLI wires this
   * to the dashboard's Accept button + autopilot countdown.
   */
  requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
  /**
   * Stop the run once cumulative agent cost reaches this many USD (budget cap,
   * #322). Checked after each turn that reports usage: the turn that crosses the
   * cap finishes, then the run stops itself (a clean stop, not a failure). Omit
   * for no cap. This gates on what *this run* spent, which is a separate question
   * from where the account's quota stands (readable via #517 / #521, and gated on
   * by #519's consumption limits).
   */
  budgetUsd?: number
  /**
   * Consult the consumption limits between turns (#529): return the limit that
   * has been reached to pause the run, or `null` to carry on.
   *
   * Must answer from a cached reading — a live quota read spawns the whole agent
   * CLI (~5s). Compose one from a `QuotaPoller` and `consumptionStatus`. Omit to
   * leave the run ungated, which is also what a gate that throws resolves to:
   * an unreadable quota must never stop the user's work (Rom's call on #519).
   */
  consumptionGate?: () => ConsumptionWindow | null
  /**
   * Run the backlog loop (#323) after the build settles: consume the agent's own
   * `TODO_<slug>.agent.md` / `TODO_AGENTS.md` one entry per turn until empty, gating
   * before each entry when {@link requestChoice} is wired. Default: on for real
   * drivers, off for the fake one (its scripted demo writes no backlog and must
   * stay deterministic). Set explicitly to force either way.
   */
  todoLoop?: boolean
  /** Per-run cap on backlog entries worked (#323). Default 25. */
  todoMaxItems?: number
  /**
   * Live chat (#714): once the build settles, stay running and take the user's own
   * messages, each resuming the build session for full context. Ends when the source
   * resolves `undefined` (Stop / budget cap). Wired only for an interactive run — a
   * headless run leaves it unset and ends when the build is done, exactly as before.
   */
  messages?: RunMessages
  /** Observe the unified event stream. */
  onEvent?: (event: FrameworkEvent) => void
}

/**
 * A running instance of the generated app, handed back so the caller can show a
 * live preview link and keep it up until the user is done (then {@link stop}).
 */
export interface AppPreview {
  /** The localhost URL the app is served at. */
  url: string
  /** The command that started it (e.g. `npm run dev`). */
  command: string
  /** Stop the app and free its runner. Idempotent. */
  stop(): Promise<void>
}

/** What a run returns. */
export interface RunFrameworkResult {
  result: BootstrapResult
  detection: FrameworkDetection
  events: FrameworkEvent[]
  /**
   * The generated app, left running when a {@link ServeConfig} was supplied and
   * the run finished. The caller owns its lifecycle: show {@link AppPreview.url},
   * then call {@link AppPreview.stop} (e.g. on Ctrl+C). Absent when no serve
   * config was set or the app could not be booted.
   */
  preview?: AppPreview
  /**
   * The domain preset's review policy, materialized against this run's driver:
   * its loops plus its prompts as driver-backed passes. Present only when a
   * {@link RunFrameworkOptions.preset} was supplied. It also drives the run's
   * production-grade review phase (#252): each checklist pass dispatches a
   * `major-change` event through it, so its chain replaces the built-in checklist.
   */
  loop?: LoopEngine
  /** How the backlog loop (#323) ended, when it ran. */
  todo?: TodoLoopResult
}

/**
 * Run the whole turnkey flow: detect the framework preset, frame the wrapped
 * agent with its framework skill (page builder + docs), then drive ai-autopilot's `Bootstrap`
 * (scope → build → full-fledged loop → deploy) entirely *through*
 * the driver (option A). Every phase, plus the agent's own progress, streams as
 * a {@link FrameworkEvent}. Reversible: swap in a real deploy target, or a
 * different `Driver`, without touching this wiring.
 */
export async function runFramework(opts: RunFrameworkOptions): Promise<RunFrameworkResult> {
  const events: FrameworkEvent[] = []
  const emit = (event: FrameworkEvent) => {
    events.push(event)
    if (opts.onEvent) {
      try {
        opts.onEvent(event)
      } catch (err) {
        console.error('[framework] onEvent threw; ignoring:', err)
      }
    }
  }

  // 1. Detect the framework the project already uses. Detection only narrates
  // ("Detected Vike") and rides the result — nothing about it reaches the agent's
  // prompt (#547).
  const signals = opts.signals ?? {}
  const { preset, detection } = builtinPresetRegistry().select(signals)
  const domainPreset = opts.preset
  // The built-in #326 system prompt + any user SYSTEM.md are the whole prompt. Only
  // the template's system half is used here: each Bootstrap step composes its own
  // prompt around the intent, so the user-prompt slot stays with the steps.
  // `tf.params.autopilot` reflects the run's autopilot mode (#325).
  const tf: TfContext = {
    prompt: opts.intent,
    params: { autopilot: opts.modes?.includes('autopilot') ?? false, ...(opts.eco ? { eco: opts.eco } : {}) },
  }
  // One assembly path for the whole system channel (#501), shared with the
  // direct-prompt path so the two can never drift (the drift behind #500).
  const system = composeRunSystem({
    antiLazyPill: opts.antiLazyPill,
    transparent: opts.transparent,
    user: opts.systemPrompt,
    tf,
    context: opts.context,
  })

  emitSessionStart({ emit, driver: opts.driver, cwd: opts.cwd, sessionLink: opts.sessionLink })
  // Surface the exact system prompt the agent runs under (#343). Nothing is read
  // off disk and appended after this, so the text is the whole of it (#547). The
  // per-turn user prompts ride along as `driver` `start` events, so the dashboard
  // can show every prompt sent.
  if (system) emit({ kind: 'system-prompt', text: system })
  emit({
    kind: 'log',
    message: `Detected ${detection.framework ?? preset.framework} (confidence ${detection.confidence})`,
  })
  if (domainPreset) {
    const modeNote = opts.modes?.length ? ` (modes: ${opts.modes.join(', ')})` : ''
    emit({
      kind: 'log',
      message: `Domain preset: ${domainPreset.title}${modeNote}; ${domainPreset.loops.length}-loop review policy in effect`,
    })
    // Surface the run's active modes as read-only checkboxes on the dashboard (#272).
    emit({ kind: 'modes', all: OPEN_LOOP_MODES, active: opts.modes ?? [] })
  }

  // The run's abort plumbing and driver-event sink: the caller's signal composed with
  // the budget (#322), consumption (#529), and plan-decline (#358) self-stops.
  const { runSignal, onDriverEvent, consumptionTrip, budgetController, consumptionController, declineController } =
    createRunControls({
      emit,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.sessionLink ? { sessionLink: opts.sessionLink } : {}),
      ...(opts.budgetUsd != null ? { budgetUsd: opts.budgetUsd } : {}),
      ...(opts.consumptionGate ? { consumptionGate: opts.consumptionGate } : {}),
    })

  // 2. One driver session for the whole run; each prompt is a fresh invocation.
  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    signal: runSignal,
    onEvent: onDriverEvent,
  })

  // The domain preset's review policy (exposed on the result) and the production-grade
  // review checklist it drives.
  const { loop, reviewChecklist } = buildReview(session, domainPreset, {
    ...(opts.buildEvent ? { buildEvent: opts.buildEvent } : {}),
    signal: runSignal,
    emit,
  })

  // Boot-and-serve gate: provision a runner so the checklist can gate on the app
  // actually running. Local adopts (never deletes) the driver's cwd in place; docker
  // sandboxes the check in a throwaway container (#229). An injected runner wins over both.
  const sandbox = opts.sandbox ?? 'local'
  const s = opts.serve
  let runner: RunnerSession | undefined
  if (s) runner = opts.runner ?? (await provisionServeRunner(sandbox, opts.cwd, s, emit))
  const checklist = withServeCheck(reviewChecklist, runner, s, {
    sandbox,
    cwd: opts.cwd,
    injectedRunner: opts.runner !== undefined,
    emit,
  })

  // A real driver writes files to the workspace, so the build/improve steps can
  // detect an empty workspace and hard-scaffold it (#182). The fake driver writes
  // nothing (its whole workspace is always "empty"), so it opts out to stay
  // deterministic.
  const verifyWorkspace = opts.driver.name !== 'fake'
  const workspaceOpt = verifyWorkspace ? { verifyWorkspace: true } : {}

  // The shared deps of every agent-facing gate.
  const gateDeps = {
    ...(opts.requestChoice ? { requestChoice: opts.requestChoice } : {}),
    emit,
    signal: runSignal,
    onDecline: () => declineController.abort(new Error('[framework] plan declined')),
  }
  let preview: AppPreview | undefined
  try {
    const bootstrap = new Bootstrap({
      maxPasses: opts.maxPasses ?? DEFAULT_MAX_PASSES,
      signal: runSignal,
      onEvent: (event: BootstrapEvent) => emit({ kind: 'bootstrap', event }),
      steps: {
        scope: () => ({ scope: opts.scope ?? 'full', intent: opts.intent }),
        build: agentAwaitGate(driverBuild(session, workspaceOpt), session, gateDeps),
        checklist,
        improve: driverImprove(session, workspaceOpt),
        ...(opts.deploy
          ? {
              deploy: opts.deployTarget
                ? deployWith(opts.deploy, opts.deployTarget)
                : decideDeploy(opts.deploy),
            }
          : {}),
      },
    })
    const result = await bootstrap.run()
    // The backlog loop (#323): with the build settled, consume the agent's own
    // TODO backlog one gated entry per turn until it is empty. Default on for
    // real drivers (the fake demo writes no backlog and must stay deterministic;
    // its reused tmp workspace could also carry stale files). The run signal
    // (Stop / budget cap #322) and the item cap bound it for unattended runs.
    let todo: TodoLoopResult | undefined
    if (opts.todoLoop ?? opts.driver.name !== 'fake') {
      todo = await runTodoLoop({
        session,
        cwd: opts.cwd,
        emit,
        requestChoice: opts.requestChoice,
        signal: runSignal,
        maxItems: opts.todoMaxItems,
      })
    }
    // The serve gate boots the app only to check it, then stops it. When the
    // caller opts in (keepAlive), boot it once more after success and leave it up
    // so the user can open it; the caller owns tearing it down (Ctrl+C). Failure
    // to boot is non-fatal. Default off, so a programmatic run never leaks a
    // process a caller that ignores `preview` would never stop.
    if (runner && s?.keepAlive) preview = await startAppPreview(runner, s, emit)
    // Live chat (#714): with the build settled, stay open for the user's own messages,
    // each continuing the same session. Ends on Stop / budget cap (next -> undefined).
    if (opts.messages) {
      await runChatPhase(session, opts.messages, { text: '' }, {
        ...(opts.requestChoice ? { requestChoice: opts.requestChoice } : {}),
        emit,
        emitTurnSignals: createTurnSignalEmitter(emit),
        signal: runSignal,
      })
    }
    emit({ kind: 'end', ok: true })
    return { result, detection, events, ...(preview ? { preview } : {}), ...(loop ? { loop } : {}), ...(todo ? { todo } : {}) }
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
    // Keep the runner alive only when it owns a live preview handed to the caller.
    if (runner && !preview) await runner.dispose()
  }
}

/**
 * Materialize the domain preset's review policy against the run's driver, and the
 * production-grade review checklist it drives. Default: the built-in checklist. With a
 * domain preset, its loop *replaces* the checklist (#252) — each pass fires the preset's
 * review chain through the driver — falling back to the built-in when the preset has no
 * loop for the build event, so a run is never left unreviewed. The build event kind: an
 * explicit run choice wins, else the preset's own default, else `major-change` — how a
 * `bug-fix` run reaches the preset's bug-fix loop (#265). The `loop` is returned so the
 * caller can expose it on the result.
 */
function buildReview(
  session: DriverSession,
  domainPreset: DomainPreset | undefined,
  ctx: { buildEvent?: string; signal: AbortSignal; emit: (event: FrameworkEvent) => void },
): { loop: LoopEngine | undefined; reviewChecklist: NonNullable<BootstrapSteps['checklist']> } {
  const loop = domainPreset
    ? new LoopEngine({
        loops: [...domainPreset.loops],
        prompts: driverLoopPrompts(session, domainPreset.prompts, { signal: ctx.signal }),
      })
    : undefined
  const buildEvent = ctx.buildEvent ?? domainPreset?.defaultEvent ?? 'major-change'
  const reviewChecklist = loop
    ? domainLoopChecklist(loop, { kind: buildEvent, fallback: driverChecklist(session) })
    : driverChecklist(session)
  if (loop && domainPreset) {
    ctx.emit({ kind: 'log', message: `Review policy: the ${domainPreset.title} loop drives the ${buildEvent} review` })
  }
  return { loop, reviewChecklist }
}

/**
 * Union the review checklist with a boot-and-serve gate (#229) when the run has a runner:
 * `serveCheck` verifies the app actually boots, and `mergeChecklists` runs it alongside
 * the review. A docker sandbox re-seeds the container from the host source before every
 * check (the build writes to the host each pass); local reads the host dir live, so it
 * needs no sync. Without a runner/serve the review checklist stands alone.
 */
function withServeCheck(
  review: NonNullable<BootstrapSteps['checklist']>,
  runner: RunnerSession | undefined,
  serve: ServeConfig | undefined,
  ctx: { sandbox: 'local' | 'docker'; cwd: string; injectedRunner: boolean; emit: (event: FrameworkEvent) => void },
): NonNullable<BootstrapSteps['checklist']> {
  if (!runner || !serve) return review
  const check = serveCheck(runner, {
    serve: serve.command,
    ...(serve.install ? { install: serve.install } : {}),
    ...(serve.build ? { build: serve.build } : {}),
    ...(serve.port !== undefined ? { port: serve.port } : {}),
    ...(serve.waitMs !== undefined ? { waitMs: serve.waitMs } : {}),
    ...(serve.healthPath ? { healthPath: serve.healthPath } : {}),
    onProgress: message => ctx.emit({ kind: 'log', message: `serve: ${message}` }),
  })
  const serveStep = ctx.sandbox === 'docker' && !ctx.injectedRunner ? syncThenServe(runner, ctx.cwd, check, ctx.emit) : check
  return mergeChecklists(review, serveStep)
}


/**
 * The agent-authored await gate (#337 / #339): the turn-boundary counterpart to the
 * framework-emitted plan-approval gate (#304). When a build turn ends by asking the
 * user — an `await-choices` (pick one), `await-multiselect` (pick any), or
 * `await-confirmation` (approve/decline a plan, #358) block per
 * {@link AWAIT_PROTOCOL}, e.g. the #326 alternatives flow or the [Research] preset (#331)
 * — rather than finishing, show it, wait for the answer, and re-prompt the driver to
 * continue from that decision. A no-op unless a {@link RunFrameworkOptions.requestChoice}
 * handler is wired (headless byte-identical), and unless the agent actually stopped to
 * ask (the common case returns straight through). Bounded so an agent that keeps asking
 * can't loop forever.
 */
function agentAwaitGate(
  base: (ctx: BuildContext) => Promise<SupervisorRun>,
  session: DriverSession,
  deps: {
    requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
    emit: (event: FrameworkEvent) => void
    /** The run signal; a gate parked for an answer unblocks (default) if the run aborts. */
    signal?: AbortSignal
    /** Called when a confirmation gate is declined (#358): the run stops instead of building on. */
    onDecline?: () => void
  },
): (ctx: BuildContext) => Promise<SupervisorRun> {
  return async ctx => {
    const { requestChoice, emit } = deps
    // Non-blocking signals the agent emitted this turn: markdown views (#441) pushed to the
    // rail, and the #326 lifecycle signals (session name, ready-for-merge) that flip the run's
    // dashboard status. None stop the turn.
    const emitTurnSignals = createTurnSignalEmitter(emit)
    let run = await base(ctx)
    emitTurnSignals(run.text)
    if (!requestChoice) return run

    for (let round = 0; round < MAX_AWAIT_ROUNDS; round++) {
      const gate = parseAwaitGate(run.text)
      if (!gate) return run // the agent finished instead of asking — the common case
      const answer = await resolveAwaitGate(gate, round, deps)
      if (isDeclinedConfirmation(gate, answer)) {
        // A declined plan (#358) ends the build here rather than re-prompting: the
        // user takes over with fresh instructions (e.g. a new run from the dashboard).
        emit({ kind: 'log', message: PLAN_DECLINED_MESSAGE })
        deps.onDecline?.()
        return run
      }
      emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
      run = await continueAfterChoice(session, ctx, gate.title, answer)
      emitTurnSignals(run.text)
    }
    // The agent kept asking past the limit: proceed with the latest turn rather than loop.
    emit({ kind: 'log', message: 'Proceeding with the build (await limit reached).' })
    return run
  }
}

/**
 * Resolve one parsed await gate (#337/#339) to the user's answer text, ready to
 * seed the continuation prompt: emits the `choice`, parks for the pick (or the
 * headless/abort fallback), and maps the picked id(s) back to label(s). Round 0
 * keeps a stable gate id; later rounds get a unique one so a dashboard never
 * confuses a re-ask with the answer it just resolved. Shared by the build's
 * {@link agentAwaitGate}, the direct prompt path, and the backlog loop (#323).
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
  const baseId = gate.kind === 'multi' ? 'await-multiselect' : gate.kind === 'confirm' ? 'await-confirmation' : 'await-choices'
  const id = round === 0 ? baseId : `${baseId}-${round}`
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
}

/** The shared deps of a turn that may hit an await gate or a chat message. */
interface AwaitTurnDeps {
  requestChoice?: ((req: ChoiceRequest) => Promise<ChoicePick>) | undefined
  emit: (event: FrameworkEvent) => void
  emitTurnSignals: (text: string) => void
  signal?: AbortSignal | undefined
}

/**
 * Resolve the await gates (#337/#339) a turn ended on: pick the answer, re-prompt with
 * it, repeat until the agent stops asking or the {@link MAX_AWAIT_ROUNDS} cap trips. A
 * declined plan (#358) stops here. Returns the settled turn plus whether it declined /
 * was still asking at the cap. Shared by the opening prompt and each chat message.
 */
async function drainGates(session: DriverSession, turn: DriverTurn, deps: AwaitTurnDeps): Promise<{ turn: DriverTurn; declined: boolean; exhausted: boolean }> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  let gate = parseAwaitGate(turn.text)
  for (let round = 0; round < MAX_AWAIT_ROUNDS && gate; round++) {
    const answer = await resolveAwaitGate(gate, round, deps)
    if (isDeclinedConfirmation(gate, answer)) {
      deps.emit({ kind: 'log', message: PLAN_DECLINED_MESSAGE })
      return { turn, declined: true, exhausted: false }
    }
    deps.emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
    turn = await session.prompt(continuationPrompt(gate.title, answer), signalOpt)
    deps.emitTurnSignals(turn.text)
    gate = parseAwaitGate(turn.text)
  }
  return { turn, declined: false, exhausted: gate !== undefined }
}

/**
 * The live-chat loop (#714): wait for the user's next message, deliver it by resuming the
 * same session (full conversational context), then honor any await gate it produced —
 * repeat until the source resolves `undefined` (Stop / budget cap). This is the "stay-open"
 * lifecycle: a run keeps running as a conversation until the user ends it. Shared by the
 * direct prompt path and the build path, which both reach it once their work has settled.
 */
export async function runChatPhase(session: DriverSession, messages: RunMessages, seed: DriverTurn, deps: AwaitTurnDeps): Promise<DriverTurn> {
  const signalOpt = deps.signal ? { signal: deps.signal } : {}
  let turn = seed
  for (;;) {
    const message = await messages.next(deps.signal)
    if (message === undefined) return turn // Stop / budget cap: end the conversation.
    deps.emit({ kind: 'log', message: `You: ${message}` })
    turn = await session.prompt(message, { ...signalOpt, resume: true })
    deps.emitTurnSignals(turn.text)
    const drained = await drainGates(session, turn, deps)
    turn = drained.turn
    if (drained.declined) return turn
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
 *
 * The build's {@link agentAwaitGate} is deliberately not this: it wraps a supervisor pass
 * rather than a raw prompt, and skips gates entirely when headless.
 */
export async function runAwaitRounds(opts: AwaitRoundsOptions): Promise<AwaitRoundsResult> {
  const { session, emit, emitTurnSignals, messages } = opts
  const deps: AwaitTurnDeps = { requestChoice: opts.requestChoice, emit, emitTurnSignals, signal: opts.signal }
  const signalOpt = opts.signal ? { signal: opts.signal } : {}

  const opening = await session.prompt(opts.prompt, signalOpt)
  emitTurnSignals(opening.text)
  const drained = await drainGates(session, opening, deps)
  if (drained.declined) return { text: drained.turn.text, declined: true, exhausted: false }

  // Live chat (#714): stay open for the user's messages until Stop. Headless leaves it unset,
  // so the run ends here exactly as before.
  const finalTurn = messages ? await runChatPhase(session, messages, drained.turn, deps) : drained.turn
  return { text: finalTurn.text, declined: false, exhausted: drained.exhausted }
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

/**
 * Boot the generated app in the adopted runner and keep it serving. Reuses the
 * same {@link ServeConfig} the serve gate used (deps are already installed from
 * the gate), so this only `start`s the server and `preview`s the port. Returns a
 * handle that stops the app and frees the runner; on any failure it narrates and
 * returns `undefined` so a run never fails just because the demo preview didn't
 * come up.
 */
async function startAppPreview(
  runner: RunnerSession,
  serve: ServeConfig,
  emit: (event: FrameworkEvent) => void,
): Promise<AppPreview | undefined> {
  if (!runner.start || !runner.preview) return undefined
  let proc: Awaited<ReturnType<NonNullable<RunnerSession['start']>>> | undefined
  try {
    proc = await runner.start(serve.command)
    const { url } = await runner.preview({
      port: serve.port ?? 3000,
      waitMs: serve.waitMs ?? 15_000,
    })
    emit({ kind: 'preview', url, command: serve.command })
    let stopped = false
    return {
      url,
      command: serve.command,
      stop: async () => {
        if (stopped) return
        stopped = true
        try {
          await proc?.stop()
        } finally {
          await runner.dispose()
        }
      },
    }
  } catch (err) {
    emit({ kind: 'log', message: `preview: could not boot the app (${err instanceof Error ? err.message : String(err)})` })
    // Leave cleanup to the caller's finally (runner.dispose stops leftovers).
    return undefined
  }
}

/**
 * Provision the runner the serve gate verifies in (#229). `local` adopts the host
 * cwd in place (dispose leaves it); `docker` boots a throwaway container the check
 * seeds and tears down. Fails fast with a clear message when docker is requested
 * but not reachable, so the run never limps on unsandboxed by surprise.
 */
async function provisionServeRunner(
  sandbox: 'local' | 'docker',
  cwd: string,
  serve: ServeConfig,
  emit: (event: FrameworkEvent) => void,
): Promise<RunnerSession> {
  if (sandbox === 'docker') {
    if (!(await dockerAvailable())) {
      throw new Error(
        'sandbox: --sandbox docker was requested but Docker is not reachable (need a running daemon and the `docker` CLI on PATH).',
      )
    }
    emit({ kind: 'log', message: 'sandbox: booting a Docker container for the serve check' })
    // preview() publishes the container's fixed port, so it must match the port the
    // serve check previews on (serve.port, default 3000).
    return new DockerRunner({ previewPort: serve.port ?? 3000 }).boot()
  }
  return new LocalRunner().adopt(cwd)
}

/**
 * Wrap a serve check so the sandbox is re-seeded with the host source before it
 * runs. The build happens on the host in this slice, so an isolated container has
 * to be synced each pass to see what the agent just wrote.
 */
function syncThenServe(
  runner: RunnerSession,
  cwd: string,
  check: NonNullable<BootstrapSteps['checklist']>,
  emit: (event: FrameworkEvent) => void,
): NonNullable<BootstrapSteps['checklist']> {
  return async (ctx: LoopPassContext): Promise<Verdict> => {
    const files = await snapshotWorkspace(cwd)
    for (const [path, contents] of Object.entries(files)) await runner.fs.write(path, contents)
    emit({ kind: 'log', message: `serve: synced ${Object.keys(files).length} file(s) into the sandbox` })
    return check(ctx)
  }
}
