import type { SupervisorEvent, SupervisorRun } from '../types.js'
import type { Verdict } from '../loop/verdict.js'

/**
 * Bootstrap mode — the spine that takes a user from nothing to a running,
 * well-structured app (#116). It sequences autopilot's existing primitives into
 * one flow:
 *
 *   scope  →  build  →  full-fledged loop
 *
 * - **Scope** is the one and only interrogation: prototype vs full, plus intent.
 * - **Build** runs the Supervisor inside a runner,
 *   streaming narration; the caller can interrupt via an `AbortSignal`.
 * - **Full-fledged loop** (full scope only) repeats the production-grade
 *   checklist with fresh context, improving against its `{ blockers }` verdict
 *   until it is empty or a `maxPasses` budget stops it.
 *
 * The orchestrator ({@link Bootstrap}) owns the sequencing, narration, and loop
 * control; the {@link BootstrapSteps} are injected, so a test drives it with
 * stubs + a {@link FakeRunner} while production wires real agents. Its narration
 * rides the generic surface stream (`EventStream<BootstrapEvent>`).
 */

/** How much app the user wants: a quick prototype, or the full production thing. */
export type BootstrapScope = 'prototype' | 'full'

/** The phase a narration line belongs to. */
export type BootstrapPhase = 'scope' | 'build' | 'loop' | 'deploy'

/** The answer to the one upfront question. */
export interface ScopeAnswer {
  scope: BootstrapScope
  /** What the user wants built, in their words. */
  intent: string
}

/** How the app is rendered/served, which drives the deploy shape. */
export type RenderMode = 'ssr' | 'ssg' | 'spa'

/** The deploy decision: how to render, where to ship, and why. */
export interface DeployPlan {
  render: RenderMode
  /** The deploy target's name (e.g. "dokploy", "cloudflare"). */
  target: string
  /** One-line rationale, to narrate. */
  reason: string
}

/** What a {@link DeployTarget} reports back. */
export interface DeployResult {
  /** True when a real deploy ran; false for a plan-only (v1 default) target. */
  deployed: boolean
  /** The live URL, when a real adapter produced one. */
  url?: string
  /** Human-readable detail (what happened, or why nothing did). */
  detail?: string
}

/** The result of the deploy phase: the decided plan and, if a target ran, its result. */
export interface DeployOutcome {
  plan: DeployPlan
  result: DeployResult
}

/** Context handed to a {@link DeployTarget}. */
export interface DeployTargetContext {
  plan: DeployPlan
  intent: string
  signal?: AbortSignal
}

/**
 * The deploy adapter seam — the same pattern as the runner seam (#109). v1 ships
 * only plan-only targets ({@link planOnlyTarget}) and a fake for tests; real
 * Dockploy / Cloudflare adapters implement this behind the same interface and
 * are infra-gated follow-ups. A target *executes* a {@link DeployPlan}; deciding
 * the plan is the deploy step's job.
 */
export interface DeployTarget {
  /** Stable name, matched against {@link DeployPlan.target}. */
  readonly name: string
  /** Execute the plan (or, for a plan-only target, report that it did not). */
  deploy(ctx: DeployTargetContext): DeployResult | Promise<DeployResult>
}

/**
 * A narration/progress event bootstrap emits over the generic surface stream.
 * The build phase forwards the Supervisor's own events verbatim under `build`.
 */
export type BootstrapEvent =
  | { type: 'scope'; scope: BootstrapScope; intent: string }
  | { type: 'narrate'; phase: BootstrapPhase; message: string }
  | { type: 'build'; event: SupervisorEvent }
  | { type: 'checklist'; pass: number; blockers: readonly string[]; passing: boolean }
  | { type: 'improve'; pass: number; blockers: readonly string[] }
  | { type: 'deploy'; plan: DeployPlan; result: DeployResult }
  | { type: 'done'; result: BootstrapResult }

/** The outcome of a bootstrap run. */
export interface BootstrapResult {
  scope: BootstrapScope
  intent: string
  /** The initial build's supervised run. */
  run: SupervisorRun
  /** Full-fledged passes performed (0 for a prototype, or when no checklist ran). */
  passes: number
  /** Remaining blockers from the last checklist; empty means nothing left to fix. */
  blockers: readonly string[]
  /** True when the full-fledged loop ran and ended with no blockers. */
  productionGrade: boolean
  /** True when the loop hit `maxPasses` with blockers still open. */
  stoppedEarly: boolean
  /** The deploy phase's outcome, when a `deploy` step ran. */
  deploy?: DeployOutcome
}

/** Context handed to the build step. */
export interface BuildContext {
  scope: BootstrapScope
  intent: string
  /** Forward each Supervisor event here so bootstrap can narrate the build. */
  onEvent: (event: SupervisorEvent) => void
  signal?: AbortSignal
}

/** Context handed to the deploy step (the final phase). */
export interface DeployContext {
  scope: BootstrapScope
  intent: string
  /** Whether the full-fledged loop ended clean, so the step can factor readiness in. */
  productionGrade: boolean
  signal?: AbortSignal
}

/** Context handed to the improve / checklist steps in the full-fledged loop. */
export interface LoopPassContext {
  /** 1-based pass number; each pass is meant to run with fresh context. */
  pass: number
  intent: string
  /** The blockers the checklist last reported (empty on the improve of pass 1). */
  blockers: readonly string[]
  signal?: AbortSignal
}

/**
 * The injectable steps. Only `scope` and `build` are required;
 * `checklist` (and its paired `improve`) drive the full-fledged loop and are used
 * only for `scope: 'full'`.
 */
export interface BootstrapSteps {
  /** The one upfront question. */
  scope: () => ScopeAnswer | Promise<ScopeAnswer>
  /** Run the build (Supervisor over a runner). */
  build: (ctx: BuildContext) => SupervisorRun | Promise<SupervisorRun>
  /** Report the production-grade verdict for a pass. Full scope only. */
  checklist?: (ctx: LoopPassContext) => Verdict | Promise<Verdict>
  /** Address the current blockers with fresh context, before the next checklist. */
  improve?: (ctx: LoopPassContext) => unknown | Promise<unknown>
  /** Decide SSR/SSG/SPA + target, narrate, and (via a target) deploy. The final phase. */
  deploy?: (ctx: DeployContext) => DeployOutcome | Promise<DeployOutcome>
}

/** Options for {@link Bootstrap}. */
export interface BootstrapOptions {
  steps: BootstrapSteps
  /** Max full-fledged passes before stopping with blockers open. Default 3. */
  maxPasses?: number
  /** Observe narration. Isolated: a throwing callback is logged and swallowed. */
  onEvent?: (event: BootstrapEvent) => void
  /** Interrupt the run between phases (the "user can interrupt" affordance). */
  signal?: AbortSignal
}
