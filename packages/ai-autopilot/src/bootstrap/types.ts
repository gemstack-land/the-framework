import type { DecisionLedger } from '../decisions/ledger.js'
import type { SupervisorEvent, SupervisorRun } from '../types.js'
import type { Verdict } from '../loop/verdict.js'

/**
 * Bootstrap mode — the spine that takes a user from nothing to a running,
 * well-structured app (#116). It sequences autopilot's existing primitives into
 * one flow:
 *
 *   scope  →  architect  →  build  →  full-fledged loop
 *
 * - **Scope** is the one and only interrogation: prototype vs full, plus intent.
 * - **Architect** picks the stack (Vike + universal-orm), narrates it, and
 *   records key choices to the decisions ledger — no permission asked.
 * - **Build** runs the Supervisor over the stack personas inside a runner,
 *   streaming narration; the caller can interrupt via an `AbortSignal`.
 * - **Full-fledged loop** (full scope only) repeats the production-grade
 *   checklist with fresh context, improving against its `{ blockers }` verdict
 *   until it is empty or a `maxPasses` budget stops it.
 *
 * The orchestrator ({@link Bootstrap}) owns the sequencing, narration, and loop
 * control; the four {@link BootstrapSteps} are injected, so a test drives it with
 * stubs + a {@link FakeRunner} while production wires real agents. Its narration
 * rides the generic surface stream (`EventStream<BootstrapEvent>`).
 */

/** How much app the user wants: a quick prototype, or the full production thing. */
export type BootstrapScope = 'prototype' | 'full'

/** The phase a narration line belongs to. */
export type BootstrapPhase = 'scope' | 'architect' | 'build' | 'loop'

/** The answer to the one upfront question. */
export interface ScopeAnswer {
  scope: BootstrapScope
  /** What the user wants built, in their words. */
  intent: string
}

/** One architectural choice the architect made and why — recorded to the ledger. */
export interface ArchitectDecision {
  choice: string
  why: string
}

/** The architect's output: the stack it chose, a narration, and the key choices. */
export interface ArchitectPlan {
  /** The chosen stack, one line (e.g. "Vike + universal-orm, Postgres, vike-auth"). */
  stack: string
  /** What it is building and why, to narrate to the user. */
  narration: string
  /** Key choices to record to the decisions ledger so they are not re-litigated. */
  decisions: readonly ArchitectDecision[]
}

/**
 * A narration/progress event bootstrap emits over the generic surface stream.
 * The build phase forwards the Supervisor's own events verbatim under `build`.
 */
export type BootstrapEvent =
  | { type: 'scope'; scope: BootstrapScope; intent: string }
  | { type: 'architect'; stack: string; decisions: readonly ArchitectDecision[] }
  | { type: 'narrate'; phase: BootstrapPhase; message: string }
  | { type: 'build'; event: SupervisorEvent }
  | { type: 'checklist'; pass: number; blockers: readonly string[]; passing: boolean }
  | { type: 'improve'; pass: number; blockers: readonly string[] }
  | { type: 'done'; result: BootstrapResult }

/** The outcome of a bootstrap run. */
export interface BootstrapResult {
  scope: BootstrapScope
  intent: string
  /** The architecture chosen. */
  plan: ArchitectPlan
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
}

/** Context handed to the build step. */
export interface BuildContext {
  plan: ArchitectPlan
  scope: BootstrapScope
  intent: string
  /** Forward each Supervisor event here so bootstrap can narrate the build. */
  onEvent: (event: SupervisorEvent) => void
  signal?: AbortSignal
}

/** Context handed to the architect step. */
export interface ArchitectContext {
  intent: string
  scope: BootstrapScope
  /** The ledger to consult (choices are recorded by the orchestrator, not here). */
  ledger: DecisionLedger
  signal?: AbortSignal
}

/** Context handed to the improve / checklist steps in the full-fledged loop. */
export interface LoopPassContext {
  /** 1-based pass number; each pass is meant to run with fresh context. */
  pass: number
  plan: ArchitectPlan
  intent: string
  /** The blockers the checklist last reported (empty on the improve of pass 1). */
  blockers: readonly string[]
  signal?: AbortSignal
}

/**
 * The four injectable steps. Only `scope`, `architect`, and `build` are required;
 * `checklist` (and its paired `improve`) drive the full-fledged loop and are used
 * only for `scope: 'full'`.
 */
export interface BootstrapSteps {
  /** The one upfront question. */
  scope: () => ScopeAnswer | Promise<ScopeAnswer>
  /** Pick the stack, narrate, and return the key choices. */
  architect: (ctx: ArchitectContext) => ArchitectPlan | Promise<ArchitectPlan>
  /** Run the build (Supervisor over personas + runner). */
  build: (ctx: BuildContext) => SupervisorRun | Promise<SupervisorRun>
  /** Report the production-grade verdict for a pass. Full scope only. */
  checklist?: (ctx: LoopPassContext) => Verdict | Promise<Verdict>
  /** Address the current blockers with fresh context, before the next checklist. */
  improve?: (ctx: LoopPassContext) => unknown | Promise<unknown>
}

/** Options for {@link Bootstrap}. */
export interface BootstrapOptions {
  steps: BootstrapSteps
  /** Max full-fledged passes before stopping with blockers open. Default 3. */
  maxPasses?: number
  /** The decisions ledger. A fresh one is created when omitted. */
  ledger?: DecisionLedger
  /** Observe narration. Isolated: a throwing callback is logged and swallowed. */
  onEvent?: (event: BootstrapEvent) => void
  /** Interrupt the run between phases (the "user can interrupt" affordance). */
  signal?: AbortSignal
}
