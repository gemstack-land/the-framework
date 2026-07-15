import { isPassing } from '../loop/verdict.js'
import type {
  BootstrapEvent,
  BootstrapOptions,
  BootstrapResult,
  BootstrapSteps,
  DeployOutcome,
} from './types.js'

/** Thrown when a run is aborted via the `AbortSignal`. */
export class BootstrapAborted extends Error {
  constructor() {
    super('[ai-autopilot] bootstrap run was aborted')
    this.name = 'BootstrapAborted'
  }
}

/**
 * The bootstrap orchestrator: sequences the injected {@link BootstrapSteps} into
 * scope → build → full-fledged loop, narrating each phase over
 * {@link BootstrapOptions.onEvent}. It owns the control flow (the loop, the gate,
 * the interrupt); the steps own the model/runner work, so it runs offline against
 * stubs.
 *
 * ```ts
 * const boot = new Bootstrap({ steps, onEvent: e => render(e) })
 * const result = await boot.run()
 * if (result.productionGrade) deploy(result)
 * ```
 *
 * Pair it with `launchAutopilot<BootstrapEvent, BootstrapResult>` to run detached
 * with a replayable narration stream.
 */
export class Bootstrap {
  private readonly steps: BootstrapSteps
  private readonly maxPasses: number
  private readonly signal?: AbortSignal
  private readonly emit: (event: BootstrapEvent) => void

  constructor(opts: BootstrapOptions) {
    if (opts?.steps == null) throw new TypeError('[ai-autopilot] Bootstrap requires `steps`')
    const { scope, build } = opts.steps
    if (typeof scope !== 'function') throw new TypeError('[ai-autopilot] Bootstrap needs a `scope` step')
    if (typeof build !== 'function') throw new TypeError('[ai-autopilot] Bootstrap needs a `build` step')

    const maxPasses = opts.maxPasses ?? 3
    if (!Number.isInteger(maxPasses) || maxPasses < 1) {
      throw new TypeError(`[ai-autopilot] Bootstrap maxPasses must be a positive integer, got ${opts.maxPasses}`)
    }

    this.steps = opts.steps
    this.maxPasses = maxPasses
    if (opts.signal) this.signal = opts.signal
    this.emit = makeEmitter(opts.onEvent)
  }

  /** Run the whole flow and resolve with the {@link BootstrapResult}. */
  async run(): Promise<BootstrapResult> {
    // 1. Scope — the only question we ask.
    this.throwIfAborted()
    const { scope, intent } = await this.steps.scope()
    this.emit({ type: 'scope', scope, intent })

    // 2. Build — Supervisor over the runner; forward its events as narration.
    // What stack to build on is the agent's call, not ours (#545).
    this.throwIfAborted()
    const run = await this.steps.build({
      scope,
      intent,
      onEvent: event => this.emit({ type: 'build', event }),
      ...(this.signal ? { signal: this.signal } : {}),
    })

    // 3. Full-fledged loop — repeat the checklist with fresh context until it is
    //    clean or the pass budget runs out. Prototype scope skips this.
    let passes = 0
    let blockers: readonly string[] = []
    let stoppedEarly = false
    if (scope === 'full' && this.steps.checklist) {
      this.emit({ type: 'narrate', phase: 'loop', message: 'Checking the app is production-grade' })
      for (let pass = 1; pass <= this.maxPasses; pass++) {
        this.throwIfAborted()
        const verdict = await this.steps.checklist({
          pass,
          intent,
          blockers,
          ...(this.signal ? { signal: this.signal } : {}),
        })
        passes = pass
        blockers = verdict.blockers
        const passing = isPassing(verdict)
        this.emit({ type: 'checklist', pass, blockers, passing })
        if (passing) break
        if (pass === this.maxPasses) {
          stoppedEarly = true
          break
        }
        // Not passing and passes remain: improve against the blockers, fresh context.
        this.throwIfAborted()
        this.emit({ type: 'improve', pass, blockers })
        if (this.steps.improve) {
          await this.steps.improve({
            pass,
            intent,
            blockers,
            ...(this.signal ? { signal: this.signal } : {}),
          })
        }
      }
    }

    const productionGrade = passes > 0 && blockers.length === 0

    // 4. Deploy — the final phase: decide SSR/SSG/SPA + target, narrate, and hand
    //    the plan to a DeployTarget. v1 targets are plan-only (they do not ship).
    let deploy: DeployOutcome | undefined
    if (this.steps.deploy) {
      this.throwIfAborted()
      this.emit({ type: 'narrate', phase: 'deploy', message: 'Deciding how and where to deploy' })
      deploy = await this.steps.deploy({
        scope,
        intent,
        productionGrade,
        ...(this.signal ? { signal: this.signal } : {}),
      })
      this.emit({ type: 'deploy', plan: deploy.plan, result: deploy.result })
    }

    const result: BootstrapResult = {
      scope,
      intent,
      run,
      passes,
      blockers,
      productionGrade,
      stoppedEarly,
      ...(deploy ? { deploy } : {}),
    }
    this.emit({ type: 'done', result })
    return result
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw new BootstrapAborted()
  }
}

/** Factory mirror of `new Bootstrap(...)`. */
export function createBootstrap(opts: BootstrapOptions): Bootstrap {
  return new Bootstrap(opts)
}

function makeEmitter(onEvent: BootstrapOptions['onEvent']): (event: BootstrapEvent) => void {
  if (!onEvent) return () => {}
  return event => {
    try {
      onEvent(event)
    } catch (err) {
      console.error('[ai-autopilot] bootstrap onEvent callback threw; ignoring:', err)
    }
  }
}
