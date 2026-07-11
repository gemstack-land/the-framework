import {
  Bootstrap,
  DecisionLedger,
  DockerRunner,
  ExtensionRegistry,
  LocalRunner,
  LoopEngine,
  dockerAvailable,
  SkillRegistry,
  builtinExtensionNames,
  builtinPresetRegistry,
  composePersonas,
  composeSkills,
  mergeChecklists,
  neutralPersonas,
  personaInstructions,
  serveCheck,
  skillInstructions,
  skillPersonas,
  type ArchitectContext,
  type ArchitectPlan,
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapScope,
  type BootstrapSteps,
  type BuildContext,
  type DeployTarget,
  type DomainPreset,
  type FrameworkDetection,
  type FrameworkExtension,
  type FrameworkSignals,
  type LoopPassContext,
  type RunnerSession,
  type SupervisorRun,
  type Verdict,
} from '@gemstack/ai-autopilot'
import { snapshotWorkspace } from './sandbox.js'
import type { Driver, DriverEvent, DriverSession } from './driver/index.js'
import { memoryFraming, type LoadedMemory } from './memory.js'
import { systemPromptBlock, type TfContext } from './system-prompt.js'
import { AWAIT_PROTOCOL, parseAwaitGate, type ParsedAwaitGate } from './turn-gate.js'
// Value import from todo-loop.js is a benign cycle: todo-loop.js only calls
// run.js's hoisted function declarations (requestChoices / resolveAwaitGate).
import { runTodoLoop, type TodoLoopResult } from './todo-loop.js'
import { continueAfterChoice, decideDeploy, deployWith, domainLoopChecklist, driverArchitect, driverBuild, driverChecklist, driverImprove, driverLoopPrompts, reArchitect, type AwaitResolver } from './steps.js'
import { hasSessionIdPlaceholder, OPEN_LOOP_MODES, pickedIds, resolveSessionLink, type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import { UsageMeter } from './usage.js'

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
   * The repo's memory files ({@link LoadedMemory}) to frame the agent with (#260):
   * their current contents become context and the agent is told to keep the ones
   * it owns current (persistence lives in the repo as markdown). Load with
   * `loadRepoMemory(cwd)`. Omit or pass `[]` to frame no memory.
   */
  memory?: readonly LoadedMemory[]
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
  /**
   * A user-picked Open Loop domain preset ({loops, prompts, skills}) to run the
   * build under (#251). Its skills (and their personas) frame every phase, and
   * its loops + prompts are materialized into a driver-backed {@link LoopEngine}
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
  /**
   * Opt the built-in capability extensions in (auth, data, rbac, crud, shell) so
   * a from-scratch build is framed to compose them instead of hand-rolling
   * auth/data/UI. Vike-only: the built-in composers resolve inside the vike-data
   * workspace, so the opt-in is ignored on a non-Vike preset. Off by default: the
   * publish-safe path (hand-rolled + Prisma) still stands, and installed
   * extensions auto-activate by signal either way (see #190).
   */
  composeExtensions?: boolean
  /**
   * Extra {@link FrameworkExtension}s to register on top of the built-ins —
   * discovered `framework-*` packages from the project, or explicit ones. Each
   * still activates by signal or opt-in; registering does not force it on.
   */
  extensions?: readonly FrameworkExtension[]
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
   * Pause the run on an interactive choice and await a pick (#304). Called at the
   * plan-approval gate right after the architect decides the stack: the run emits a
   * `choice` event, calls this, and resumes on the returned option — proceeding as
   * planned, or re-architecting around a picked alternative. Omit for a headless
   * run: the gate then auto-accepts the recommended option without pausing. The CLI
   * wires this to the dashboard's Accept button + autopilot countdown.
   */
  requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
  /**
   * Stop the run once cumulative agent cost reaches this many USD (budget cap,
   * #322). Checked after each turn that reports usage: the turn that crosses the
   * cap finishes, then the run stops itself (a clean stop, not a failure). Omit
   * for no cap. The framework infers spend from what the agent reports, since the
   * account's usage *limit* is not retrievable under subscription auth.
   */
  budgetUsd?: number
  /**
   * Run the backlog loop (#323) after the build settles: consume the agent's own
   * `TODO_<slug>.agent.md` / `TODO.md` one entry per turn until empty, gating
   * before each entry when {@link requestChoice} is wired. Default: on for real
   * drivers, off for the fake one (its scripted demo writes no backlog and must
   * stay deterministic). Set explicitly to force either way.
   */
  todoLoop?: boolean
  /** Per-run cap on backlog entries worked (#323). Default 25. */
  todoMaxItems?: number
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
  ledger: DecisionLedger
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
 * (scope → architect → build → full-fledged loop → deploy) entirely *through*
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

  // 1. Detect the framework, then compose the active capability extensions and
  // framework skills on top — no framework is hardcoded (#190). Extensions
  // activate by signal (a dep is present) or, with --compose-extensions, by opting
  // the built-ins in for a from-scratch build. The built-in composers are Vike-only
  // (they resolve inside the vike-data workspace), so the blanket opt-in is guarded
  // to the Vike preset; on any other preset it is ignored with a log and only
  // signal-matched extensions compose (#202). The framework rides the skill seam:
  // the detected preset points at its skill (page builder + vike.dev/llms.txt),
  // which is always framed — even on an empty project where nothing signal-matched,
  // since preset selection is the fallback. No preset-supplied page-builder persona.
  const signals = opts.signals ?? {}
  const { preset, detection } = builtinPresetRegistry().select(signals)
  const optInBuiltins = opts.composeExtensions === true && preset.name === 'vike'
  if (opts.composeExtensions && !optInBuiltins) {
    emit({
      kind: 'log',
      message: `--compose-extensions ignored: the built-in extensions are Vike-only, but the detected preset is "${preset.name}". Using the hand-rolled + Prisma path.`,
    })
  }
  const extensionRegistry = new ExtensionRegistry().addAll(opts.extensions ?? [])
  const activeExtensions = extensionRegistry.match(signals, {
    include: optInBuiltins ? builtinExtensionNames : [],
  })
  // A user-picked domain preset (#251) frames the whole run: its skills (and the
  // personas they carry) compose in alongside the detected framework's skill.
  const domainPreset = opts.preset
  const matchedSkills = new SkillRegistry().match(signals)
  const skills = composeSkills({
    matched: [
      ...(preset.skill ? [preset.skill] : []),
      ...matchedSkills,
      ...(domainPreset ? domainPreset.skills : []),
    ],
    extensions: activeExtensions,
  })
  const personas = composePersonas({
    base: [...preset.personas, ...skillPersonas(skills)],
    extensions: activeExtensions,
    neutral: neutralPersonas,
  })
  // The repo's own memory files (#260) frame the agent alongside personas + skills:
  // their contents give context, and the agent is told to keep the ones it owns current.
  const memoryBlock = opts.memory && opts.memory.length ? memoryFraming(opts.memory) : ''
  // The built-in #326 system prompt + any user SYSTEM.md lead the system prompt so
  // its working agreement frames every prompt before the role/skill/memory context
  // (#301). Only the template's system half is used here: each Bootstrap step
  // composes its own prompt around the intent, so the user-prompt slot stays with
  // the steps. `tf.params.autopilot` reflects the run's autopilot mode (#325).
  const tf: TfContext = {
    prompt: opts.intent,
    params: { autopilot: opts.modes?.includes('autopilot') ?? false },
  }
  const promptBlock = systemPromptBlock({ antiLazyPill: opts.antiLazyPill, user: opts.systemPrompt, tf })
  // The await protocol (#337) concretizes the pill's showChoices()/AWAIT macros into a
  // signal the turn-boundary gate can detect, so it rides along with the pill.
  const system = [
    ...(promptBlock ? [promptBlock, AWAIT_PROTOCOL] : []),
    ...personas.map(personaInstructions),
    ...skills.map(skillInstructions),
    ...(memoryBlock ? [memoryBlock] : []),
  ].join('\n\n')

  // The session id is not known until the first driver turn returns, so a
  // templated link (`.../{sessionId}`) can only resolve later. A literal link is
  // shown right away; a template waits for `session-update`.
  const linkTemplate = opts.sessionLink
  const literalLink = linkTemplate && !hasSessionIdPlaceholder(linkTemplate) ? linkTemplate : undefined

  emit({
    kind: 'session',
    driver: opts.driver.name,
    workspace: opts.cwd,
    fake: opts.driver.name === 'fake',
    ...(literalLink ? { sessionLink: literalLink } : {}),
  })
  const extensionNote = activeExtensions.length ? `, ${activeExtensions.map(e => e.name).join(' + ')}` : ''
  const skillNote = skills.length ? `, ${skills.length} skill(s)` : ''
  emit({
    kind: 'log',
    message: `Detected ${detection.framework ?? preset.framework} (confidence ${detection.confidence}); framing with ${personas.length} persona(s)${extensionNote}${skillNote}`,
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

  // Compose the caller's signal with a budget-triggered abort (#322) so the run can
  // stop *itself* once it has spent too much, without the caller having to watch
  // usage. Everything downstream aborts on `runSignal`; only the budget path (or a
  // caller abort) trips it. With no caller signal this is just the budget signal.
  const budgetController = new AbortController()
  const runSignal = opts.signal ? AbortSignal.any([opts.signal, budgetController.signal]) : budgetController.signal

  // Watch the black box for its real session id (the {type:'result'} event) and
  // surface it as `session-update` once known — that is the honest handle a UI
  // links to. Re-emit when it changes, since each Claude Code prompt is a fresh
  // session; the dashboard just updates the link in place. The same result event
  // carries this turn's usage, which we fold into the run total and gate on (#322).
  let lastSessionId: string | undefined
  const usage = new UsageMeter()
  const onDriverEvent = (event: DriverEvent) => {
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
    // The turn that crosses the cap has already run (its cost is spent); stop the
    // run before the next one. Signalled once — the next phase's check ends it.
    if (opts.budgetUsd != null && totals.costUsd >= opts.budgetUsd && !budgetController.signal.aborted) {
      emit({ kind: 'log', message: `Budget reached: $${totals.costUsd.toFixed(4)} of $${opts.budgetUsd} — stopping the run.` })
      budgetController.abort(new Error('[framework] budget reached'))
    }
  }

  // 2. One driver session for the whole run; each prompt is a fresh invocation.
  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    signal: runSignal,
    onEvent: onDriverEvent,
  })

  const ledger = new DecisionLedger()

  // Materialize the domain preset's review policy against this run's driver: its
  // loops, with its prompts as driver-backed passes sharing the run's ledger and
  // abort signal. Exposed on the result, and driven as the review phase below (#252).
  const loop = domainPreset
    ? new LoopEngine({
        loops: [...domainPreset.loops],
        prompts: driverLoopPrompts(session, domainPreset.prompts, {
          ledger,
          signal: runSignal,
        }),
      })
    : undefined

  // The production-grade review phase. Default: the built-in checklist. With a
  // domain preset, its loop *replaces* the checklist (#252) — each pass fires the
  // preset's review chain through the driver — falling back to the built-in when
  // the preset has no loop for the build event, so a run is never left unreviewed.
  // The build event kind: an explicit run choice wins, else the preset's own
  // default, else `major-change`. This is how a `bug-fix` run reaches the preset's
  // bug-fix loop (#265).
  const buildEvent = opts.buildEvent ?? domainPreset?.defaultEvent ?? 'major-change'
  const reviewChecklist = loop
    ? domainLoopChecklist(loop, { kind: buildEvent, fallback: driverChecklist(session) })
    : driverChecklist(session)
  if (loop)
    emit({
      kind: 'log',
      message: `Review policy: the ${domainPreset!.title} loop drives the ${buildEvent} review`,
    })

  // Boot-and-serve gate: provision a runner so the checklist can gate on the app
  // actually running (mergeChecklists unions the review with a real serveCheck).
  // Local adopts (never deletes) the driver's cwd in place; docker sandboxes the
  // check in a throwaway container (#229). An injected runner wins over both.
  const sandbox = opts.sandbox ?? 'local'
  let runner: RunnerSession | undefined
  if (opts.serve) runner = opts.runner ?? (await provisionServeRunner(sandbox, opts.cwd, opts.serve, emit))
  const s = opts.serve
  let checklist: NonNullable<BootstrapSteps['checklist']> = reviewChecklist
  if (runner && s) {
    const check = serveCheck(runner, {
      serve: s.command,
      ...(s.install ? { install: s.install } : {}),
      ...(s.build ? { build: s.build } : {}),
      ...(s.port !== undefined ? { port: s.port } : {}),
      ...(s.waitMs !== undefined ? { waitMs: s.waitMs } : {}),
      ...(s.healthPath ? { healthPath: s.healthPath } : {}),
      onProgress: message => emit({ kind: 'log', message: `serve: ${message}` }),
    })
    // The build runs on the host, so a sandboxed container must be re-seeded with
    // the latest host source before every check (each pass changes it). Local reads
    // the host dir live, so it needs no sync.
    const serveStep = sandbox === 'docker' && !opts.runner ? syncThenServe(runner, opts.cwd, check, emit) : check
    checklist = mergeChecklists(reviewChecklist, serveStep)
  }

  // A real driver writes files to the workspace, so the build/improve steps can
  // detect an empty workspace and hard-scaffold it (#182). The fake driver writes
  // nothing (its whole workspace is always "empty"), so it opts out to stay
  // deterministic.
  const verifyWorkspace = opts.driver.name !== 'fake'
  const workspaceOpt = verifyWorkspace ? { verifyWorkspace: true } : {}

  // The shared deps of every agent-facing gate, plus the architect-side await
  // resolver (#356) built on them when an interactive handler is wired.
  const gateDeps = {
    ...(opts.requestChoice ? { requestChoice: opts.requestChoice } : {}),
    emit,
    signal: runSignal,
  }
  const architectAwait: { resolveAwait?: AwaitResolver } = opts.requestChoice
    ? {
        resolveAwait: async (gate, round) => {
          const answer = await resolveAwaitGate(gate, round, gateDeps)
          emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
          return answer
        },
      }
    : {}

  let preview: AppPreview | undefined
  try {
    const bootstrap = new Bootstrap({
      ledger,
      maxPasses: opts.maxPasses ?? DEFAULT_MAX_PASSES,
      signal: runSignal,
      onEvent: (event: BootstrapEvent) => emit({ kind: 'bootstrap', event }),
      steps: {
        scope: () => ({ scope: opts.scope ?? 'full', intent: opts.intent }),
        // An architect turn may itself stop to ask (#356, e.g. the #326
        // unclear-scope flow): resolve it through the same gates instead of
        // letting the stub-plan fallback swallow the question. Only when someone
        // can answer, so a headless run stays byte-identical.
        architect: planApprovalGate(driverArchitect(session, architectAwait), session, {
          ...gateDeps,
          ...architectAwait,
        }),
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
    emit({ kind: 'end', ok: true })
    return { result, detection, events, ledger, ...(preview ? { preview } : {}), ...(loop ? { loop } : {}), ...(todo ? { todo } : {}) }
  } catch (err) {
    // A user interrupt (the dashboard Stop button / Ctrl+C) or a budget cap (#322)
    // is a clean stop, not a failure — mark it so surfaces show "stopped". Budget is
    // its own signal, so it trips when the caller's signal did not.
    const budgetStopped = budgetController.signal.aborted && opts.signal?.aborted !== true
    const stopped = opts.signal?.aborted === true || budgetController.signal.aborted
    const detail = budgetStopped ? `budget reached ($${opts.budgetUsd})` : err instanceof Error ? err.message : String(err)
    emit({ kind: 'end', ok: false, ...(stopped ? { stopped: true } : {}), detail })
    throw err
  } finally {
    await session.dispose()
    // Keep the runner alive only when it owns a live preview handed to the caller.
    if (runner && !preview) await runner.dispose()
  }
}

/**
 * The plan-approval gate (#304): the AWAIT point of Rom's plan-then-AWAIT flow.
 * Wraps the architect step so that once the stack is decided, the run pauses on a
 * `choice` — "Approve this plan?", recommended = proceed, plus each architect
 * alternative as "Use <X> instead" — and resumes on the pick. Picking an
 * alternative re-architects around it (a fresh, coherent plan, not just a swapped
 * name). A no-op unless a {@link RunFrameworkOptions.requestChoice} handler is
 * wired, so a headless / programmatic run is byte-identical to before.
 */
function planApprovalGate(
  base: (ctx: ArchitectContext) => Promise<ArchitectPlan>,
  session: DriverSession,
  deps: {
    requestChoice?: (req: ChoiceRequest) => Promise<ChoicePick>
    emit: (event: FrameworkEvent) => void
    /** The run signal; a gate parked for a pick unblocks (proceed) if the run aborts. */
    signal?: AbortSignal
    /** Resolver for a re-architect turn that stops to ask (#356). */
    resolveAwait?: AwaitResolver
  },
): (ctx: ArchitectContext) => Promise<ArchitectPlan> {
  return async ctx => {
    const { requestChoice, emit } = deps
    let plan = await base(ctx)
    if (!requestChoice) return plan

    // Re-fire the gate after each re-architect so the user approves the FINAL plan,
    // not just the first (#324): a picked alternative can differ a lot from what was
    // rejected, and an autopilot run should still get one look at it. Bounded so a
    // run of alt-picks can't loop forever.
    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      const alternatives = plan.alternatives ?? []
      const options: ChoicesOption[] = [
        { id: 'proceed', label: `Proceed: ${plan.stack}` },
        ...alternatives.map((a, i) => ({
          id: `alt:${i}`,
          label: `Use ${a.option} instead`,
          ...(a.whyNot ? { detail: a.whyNot } : {}),
        })),
      ]
      // Round 0 keeps the stable `plan-approval` id; later rounds get a unique id so
      // a dashboard never confuses a re-approval with the pick it just resolved.
      const id = round === 0 ? 'plan-approval' : `plan-approval-${round}`
      // The shared single-select gate (#335): emits `choice`, parks for the pick, and
      // falls back to the recommended `proceed` if the handler rejects or the run aborts
      // (user stop / budget cap #322), so the gate never hangs.
      const picked = await requestChoices({
        id,
        title: 'Approve this plan?',
        options,
        recommended: 'proceed',
        requestChoice,
        emit,
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      const altMatch = /^alt:(\d+)$/.exec(picked)
      const chosen = altMatch ? alternatives[Number(altMatch[1])] : undefined
      if (!chosen) return plan // proceed (or an unknown pick) approves the current plan
      emit({ kind: 'log', message: `Re-architecting around your choice: ${chosen.option}` })
      plan = await reArchitect(session, ctx, plan.stack, chosen.option, deps.resolveAwait ? { resolveAwait: deps.resolveAwait } : {})
    }
    // Ran out of rounds still picking alternatives: proceed with the latest plan
    // rather than loop forever.
    emit({ kind: 'log', message: 'Proceeding with the latest plan (re-architect limit reached).' })
    return plan
  }
}

/** How many times a run may re-architect at the plan-approval gate before proceeding (#324). */
const MAX_PLAN_ROUNDS = 5

/** How many times a build may stop to ask (and be resumed) before it just proceeds (#337). */
const MAX_AWAIT_ROUNDS = 5

/**
 * The agent-authored await gate (#337 / #339): the turn-boundary counterpart to the
 * framework-emitted plan-approval gate (#304). When a build turn ends by asking the
 * user — an `await-choices` (pick one) or `await-multiselect` (pick any) block per
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
  },
): (ctx: BuildContext) => Promise<SupervisorRun> {
  return async ctx => {
    const { requestChoice, emit } = deps
    let run = await base(ctx)
    if (!requestChoice) return run

    for (let round = 0; round < MAX_AWAIT_ROUNDS; round++) {
      const gate = parseAwaitGate(run.text)
      if (!gate) return run // the agent finished instead of asking — the common case
      const answer = await resolveAwaitGate(gate, round, deps)
      emit({ kind: 'log', message: `Continuing with your choice: ${answer}` })
      run = await continueAfterChoice(session, ctx, gate.title, answer)
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
  const baseId = gate.kind === 'multi' ? 'await-multiselect' : 'await-choices'
  const id = round === 0 ? baseId : `${baseId}-${round}`
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
