import {
  Bootstrap,
  DecisionLedger,
  LocalRunner,
  builtinPresetRegistry,
  mergeChecklists,
  personaInstructions,
  presetPersonas,
  serveCheck,
  vikeExtensionPersonas,
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapScope,
  type DeployTarget,
  type FrameworkDetection,
  type FrameworkSignals,
  type LocalRunnerSession,
} from '@gemstack/ai-autopilot'
import type { Driver, DriverEvent, DriverSession } from './driver/index.js'
import { decideDeploy, deployWith, driverArchitect, driverBuild, driverChecklist, driverImprove } from './steps.js'
import { hasSessionIdPlaceholder, resolveSessionLink, type FrameworkEvent } from './events.js'

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
   * Compose the vike-* extensions instead of hand-rolling them: vike-auth for
   * auth, the universal-orm data layer for domain data, vike-rbac for
   * roles/permissions, vike-crud/vike-admin for the CRUD+admin UI, and
   * vike-themes/vike-layouts for styling and the app shell. Frames the agent
   * with the extension personas. Opt-in and Vike-only: the extensions resolve
   * inside the vike-data workspace, so the default (hand-rolled + Prisma) path
   * stays publish-safe.
   */
  composeExtensions?: boolean
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
}

/**
 * Run the whole turnkey flow: detect the framework preset, frame the wrapped
 * agent with that preset's personas, then drive ai-autopilot's `Bootstrap`
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

  // 1. Preset: detect the framework and turn its personas into prompt-framing.
  // --compose-extensions swaps the shared personas for the vike-extension set
  // (compose vike-auth/vike-rbac/vike-crud/vike-themes + the universal-orm data
  // layer instead of hand-rolling them); default keeps Prisma. The extensions
  // are Vike-only and resolve only in the vike-data workspace, so guard it: on a
  // non-Vike preset, fall back to the hand-rolled + Prisma path and say why
  // rather than framing (e.g.) Next with vike composers.
  const { preset, detection } = builtinPresetRegistry().select(opts.signals ?? {})
  const composeExtensions = opts.composeExtensions === true && preset.name === 'vike'
  if (opts.composeExtensions && !composeExtensions) {
    emit({
      kind: 'log',
      message: `--compose-extensions ignored: the vike-* extensions are Vike-only, but the detected preset is "${preset.name}". Using the hand-rolled + Prisma path.`,
    })
  }
  const personas = composeExtensions
    ? presetPersonas(preset, vikeExtensionPersonas)
    : presetPersonas(preset)
  const system = personas.map(personaInstructions).join('\n\n')

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
  emit({
    kind: 'log',
    message: `Detected ${detection.framework ?? preset.framework} (confidence ${detection.confidence}); framing with ${personas.length} persona(s)`,
  })

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

  // Boot-and-serve gate: adopt the agent's workspace so the checklist can gate
  // on the app actually running (mergeChecklists unions the agent review with a
  // real serveCheck). The runner adopts, never deletes, the driver's cwd.
  let runner: LocalRunnerSession | undefined
  if (opts.serve) runner = await new LocalRunner().adopt(opts.cwd)
  const s = opts.serve
  const checklist =
    runner && s
      ? mergeChecklists(
          driverChecklist(session),
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
      : driverChecklist(session)

  // A real driver writes files to the workspace, so the build/improve steps can
  // detect an empty workspace and hard-scaffold it (#182). The fake driver writes
  // nothing (its whole workspace is always "empty"), so it opts out to stay
  // deterministic.
  const verifyWorkspace = opts.driver.name !== 'fake'
  const workspaceOpt = verifyWorkspace ? { verifyWorkspace: true } : {}

  const ledger = new DecisionLedger()
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
    return { result, detection, events, ledger, ...(preview ? { preview } : {}) }
  } catch (err) {
    emit({ kind: 'end', ok: false, detail: err instanceof Error ? err.message : String(err) })
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
