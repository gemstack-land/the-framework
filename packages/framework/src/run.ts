import {
  Bootstrap,
  DecisionLedger,
  ExtensionRegistry,
  LocalRunner,
  LoopEngine,
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
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapScope,
  type DeployTarget,
  type DomainPreset,
  type FrameworkDetection,
  type FrameworkExtension,
  type FrameworkSignals,
  type LocalRunnerSession,
} from '@gemstack/ai-autopilot'
import type { Driver, DriverEvent, DriverSession } from './driver/index.js'
import { memoryFraming, type LoadedMemory } from './memory.js'
import { decideDeploy, deployWith, domainLoopChecklist, driverArchitect, driverBuild, driverChecklist, driverImprove, driverLoopPrompts } from './steps.js'
import { hasSessionIdPlaceholder, OPEN_LOOP_MODES, resolveSessionLink, type FrameworkEvent } from './events.js'

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
   * A user-picked Open Loop domain preset ({loops, prompts, skills}) to run the
   * build under (#251). Its skills (and their personas) frame every phase, and
   * its loops + prompts are materialized into a driver-backed {@link LoopEngine}
   * exposed as {@link RunFrameworkResult.loop}. Load it with `loadDomainPreset` /
   * `softwareDevelopmentPreset` (pass `modes` there to activate variants). Omit
   * for the framework-only run.
   */
  preset?: DomainPreset
  /**
   * The active modes for {@link preset} (e.g. `['autopilot']`), for narration.
   * The preset is expected to be loaded with these already applied; this is the
   * label shown to the user.
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
   * A link to the live agent session, shown on the dashboard. Either a literal
   * URL, or a template with `{sessionId}` (see {@link SESSION_ID_PLACEHOLDER})
   * that resolves once the wrapped agent reports its real id via `session-update`.
   */
  sessionLink?: string
  /** Interrupt the run between phases. */
  signal?: AbortSignal
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
  const system = [
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

  // Watch the black box for its real session id (the {type:'result'} event) and
  // surface it as `session-update` once known — that is the honest handle a UI
  // links to. Re-emit when it changes, since each Claude Code prompt is a fresh
  // session; the dashboard just updates the link in place.
  let lastSessionId: string | undefined
  const onDriverEvent = (event: DriverEvent) => {
    emit({ kind: 'driver', event })
    if (event.type === 'result' && event.sessionId && event.sessionId !== lastSessionId) {
      lastSessionId = event.sessionId
      const link = linkTemplate ? resolveSessionLink(linkTemplate, event.sessionId) : undefined
      emit({ kind: 'session-update', sessionId: event.sessionId, ...(link ? { sessionLink: link } : {}) })
    }
  }

  // 2. One driver session for the whole run; each prompt is a fresh invocation.
  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
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
          ...(opts.signal ? { signal: opts.signal } : {}),
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

  // Boot-and-serve gate: adopt the agent's workspace so the checklist can gate
  // on the app actually running (mergeChecklists unions the review with a real
  // serveCheck). The runner adopts, never deletes, the driver's cwd.
  let runner: LocalRunnerSession | undefined
  if (opts.serve) runner = await new LocalRunner().adopt(opts.cwd)
  const s = opts.serve
  const checklist =
    runner && s
      ? mergeChecklists(
          reviewChecklist,
          serveCheck(runner, {
            serve: s.command,
            ...(s.install ? { install: s.install } : {}),
            ...(s.build ? { build: s.build } : {}),
            ...(s.port !== undefined ? { port: s.port } : {}),
            ...(s.waitMs !== undefined ? { waitMs: s.waitMs } : {}),
            ...(s.healthPath ? { healthPath: s.healthPath } : {}),
            onProgress: message => emit({ kind: 'log', message: `serve: ${message}` }),
          }),
        )
      : reviewChecklist

  // A real driver writes files to the workspace, so the build/improve steps can
  // detect an empty workspace and hard-scaffold it (#182). The fake driver writes
  // nothing (its whole workspace is always "empty"), so it opts out to stay
  // deterministic.
  const verifyWorkspace = opts.driver.name !== 'fake'
  const workspaceOpt = verifyWorkspace ? { verifyWorkspace: true } : {}

  let preview: AppPreview | undefined
  try {
    const bootstrap = new Bootstrap({
      ledger,
      maxPasses: opts.maxPasses ?? DEFAULT_MAX_PASSES,
      ...(opts.signal ? { signal: opts.signal } : {}),
      onEvent: (event: BootstrapEvent) => emit({ kind: 'bootstrap', event }),
      steps: {
        scope: () => ({ scope: opts.scope ?? 'full', intent: opts.intent }),
        architect: driverArchitect(session),
        build: driverBuild(session, workspaceOpt),
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
    // The serve gate boots the app only to check it, then stops it. When the
    // caller opts in (keepAlive), boot it once more after success and leave it up
    // so the user can open it; the caller owns tearing it down (Ctrl+C). Failure
    // to boot is non-fatal. Default off, so a programmatic run never leaks a
    // process a caller that ignores `preview` would never stop.
    if (runner && s?.keepAlive) preview = await startAppPreview(runner, s, emit)
    emit({ kind: 'end', ok: true })
    return { result, detection, events, ledger, ...(preview ? { preview } : {}), ...(loop ? { loop } : {}) }
  } catch (err) {
    // A user interrupt (the dashboard Stop button / Ctrl+C aborts the signal) is a
    // clean stop, not a failure — mark it so surfaces show "stopped".
    const stopped = opts.signal?.aborted === true
    emit({ kind: 'end', ok: false, ...(stopped ? { stopped: true } : {}), detail: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    await session.dispose()
    // Keep the runner alive only when it owns a live preview handed to the caller.
    if (runner && !preview) await runner.dispose()
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
  runner: LocalRunnerSession,
  serve: ServeConfig,
  emit: (event: FrameworkEvent) => void,
): Promise<AppPreview | undefined> {
  if (!runner.start || !runner.preview) return undefined
  let proc: Awaited<ReturnType<NonNullable<LocalRunnerSession['start']>>> | undefined
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
