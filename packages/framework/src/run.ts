import {
  Bootstrap,
  DecisionLedger,
  builtinPresetRegistry,
  personaInstructions,
  presetPersonas,
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapScope,
  type FrameworkDetection,
  type FrameworkSignals,
} from '@gemstack/ai-autopilot'
import type { Driver, DriverSession } from './driver/index.js'
import { decideDeploy, driverArchitect, driverBuild, driverChecklist, driverImprove } from './steps.js'
import type { FrameworkEvent } from './events.js'

/** The deploy decision to narrate at the end (plan-only in v1: it does not ship). */
export interface DeployDecision {
  render: 'ssr' | 'ssg' | 'spa'
  target: string
  reason: string
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
  /** Max full-fledged passes. Default 3 (ai-autopilot's default). */
  maxPasses?: number
  /** A deploy decision to narrate at the end. Omit to skip the deploy phase. */
  deploy?: DeployDecision
  /** A claude.ai/code (or other) link to the live agent session, for the dashboard. */
  sessionLink?: string
  /** Interrupt the run between phases. */
  signal?: AbortSignal
  /** Observe the unified event stream. */
  onEvent?: (event: FrameworkEvent) => void
}

/** What a run returns. */
export interface RunFrameworkResult {
  result: BootstrapResult
  detection: FrameworkDetection
  events: FrameworkEvent[]
  ledger: DecisionLedger
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
  const { preset, detection } = builtinPresetRegistry().select(opts.signals ?? {})
  const personas = presetPersonas(preset)
  const system = personas.map(personaInstructions).join('\n\n')

  emit({
    kind: 'session',
    driver: opts.driver.name,
    workspace: opts.cwd,
    fake: opts.driver.name === 'fake',
    ...(opts.sessionLink ? { sessionLink: opts.sessionLink } : {}),
  })
  emit({
    kind: 'log',
    message: `Detected ${detection.framework ?? preset.framework} (confidence ${detection.confidence}); framing with ${personas.length} persona(s)`,
  })

  // 2. One driver session for the whole run; each prompt is a fresh invocation.
  const session: DriverSession = await opts.driver.start({
    cwd: opts.cwd,
    system,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    onEvent: event => emit({ kind: 'driver', event }),
  })

  const ledger = new DecisionLedger()
  try {
    const bootstrap = new Bootstrap({
      ledger,
      ...(opts.maxPasses ? { maxPasses: opts.maxPasses } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onEvent: (event: BootstrapEvent) => emit({ kind: 'bootstrap', event }),
      steps: {
        scope: () => ({ scope: opts.scope ?? 'full', intent: opts.intent }),
        architect: driverArchitect(session),
        build: driverBuild(session),
        checklist: driverChecklist(session),
        improve: driverImprove(session),
        ...(opts.deploy ? { deploy: decideDeploy(opts.deploy) } : {}),
      },
    })
    const result = await bootstrap.run()
    emit({ kind: 'end', ok: true })
    return { result, detection, events, ledger }
  } catch (err) {
    emit({ kind: 'end', ok: false, detail: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    await session.dispose()
  }
}
