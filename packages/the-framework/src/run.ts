import {
  Bootstrap,
  DockerRunner,
  LocalRunner,
  LoopEngine,
  dockerAvailable,
  builtinFrameworkPresetRegistry,
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
import type { Driver, DriverSession } from './driver/index.js'
import { composeRunSystem, type EcoOptions, type TfContext } from './system-prompt.js'
import { createRunControls, emitSessionStart, endStopDetail } from './run-telemetry.js'
import { AWAIT_PROTOCOL, createTurnSignalEmitter } from './turn-gate.js'
import { drainGates, runChatPhase, type BindProjectDeps, type RecordMessage } from './await-gate.js'
import { leaveResumeNote, runTodoLoop, type TodoLoopResult } from './todo-loop.js'
import { continueAfterChoice, decideDeploy, deployWith, domainLoopChecklist, driverBuild, driverChecklist, driverImprove, driverLoopPrompts } from './steps.js'
import { OPEN_LOOP_MODES, type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import type { RunMessages } from './run-messages.js'
import { errorMessage } from './error-message.js'

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
  /** This run has a real browser (#824), so the system channel says so. */
  browser?: boolean
  /**
   * This is a project-less "topic" run (#1120): advertise the bind gate (#1121) in the system
   * channel and wire {@link bind} so an `await-bind-project` / `await-create-project` gate resolves.
   */
  topic?: boolean
  /** The bind seams (#1121) a topic run's gate resolves against. Only meaningful with {@link topic}. */
  bind?: BindProjectDeps
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
   * {@link preset}, which is expected to be loaded with them already applied.
   * (`autopilot` no longer steers the system prompt: #556 moved the maintenance
   * section out, leaving the choice-gate countdown as its whole effect. See #801.)
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
  consumptionGate?: () => string | null
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
  /** Record each chat turn to the committed conversation (#908). Best-effort; unset = not recorded. */
  recordMessage?: RecordMessage
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
  const { preset, detection } = builtinFrameworkPresetRegistry().select(signals)
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
    browser: opts.browser,
    topic: opts.topic,
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
      signal: opts.signal,
      sessionLink: opts.sessionLink,
      budgetUsd: opts.budgetUsd,
      consumptionGate: opts.consumptionGate,
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
    // Topic runs only (#1121): resolves an await-bind-project / await-create-project gate.
    ...(opts.bind ? { bind: opts.bind } : {}),
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
        ...(opts.recordMessage ? { recordMessage: opts.recordMessage } : {}),
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
    /** The bind seams for a topic run (#1121); absent for every other run. */
    bind?: BindProjectDeps
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
    // Headless: nobody to ask, so the build's turn stands as it is rather than auto-answering
    // its own question. (The prompt paths differ here — they resolve to the recommended pick.)
    if (!requestChoice) return run

    const drained = await drainGates(run, { ...deps, emitTurnSignals }, (question, answer) =>
      continueAfterChoice(session, ctx, question, answer),
    )
    // A declined plan (#358) ends the build here rather than re-prompting: the user takes over
    // with fresh instructions (e.g. a new run from the dashboard).
    if (drained.declined) deps.onDecline?.()
    // The agent kept asking past the limit: proceed with the latest turn rather than loop.
    else if (drained.exhausted) emit({ kind: 'log', message: 'Proceeding with the build (await limit reached).' })
    return drained.turn
  }
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
    emit({ kind: 'log', message: `preview: could not boot the app (${errorMessage(err)})` })
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
