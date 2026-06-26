import type { Agent, TokenUsage } from '@gemstack/ai-sdk'

/** A unit of work the supervisor dispatches to a worker agent. */
export interface Subtask {
  /** Stable id; auto-assigned (`subtask-N`) when a planner omits it. */
  id?: string
  /** What the subtask asks for — becomes the worker agent's prompt. */
  description: string
  /** Worker pool key, when `workers` is a `Record<string, Agent>`. */
  worker?: string
}

/** A subtask with its id resolved — what the supervisor actually runs. */
export type PlannedSubtask = Subtask & { id: string }

/** The outcome of dispatching a single subtask to a worker. */
export interface SubtaskResult {
  subtask: PlannedSubtask
  /** The worker's final text. Empty string when the worker failed. */
  text: string
  /** `false` when the worker threw or paused (client-tool / approval round-trip). */
  ok: boolean
  /** The failure, when `ok` is false. */
  error?: unknown
  /** Token usage for this worker run (zeroed on failure). */
  usage: TokenUsage
}

/** The full result of a supervised run. */
export interface SupervisorRun {
  /** The synthesized final answer. */
  text: string
  /** The plan that was executed (after any guardrail trimming). */
  plan: PlannedSubtask[]
  /** One result per dispatched subtask, in plan order. */
  results: SubtaskResult[]
  /**
   * Aggregate token usage across the dispatched subtasks. Planning and
   * synthesis usage is not included: the `Planner` / `Synthesizer` contracts
   * return data, not usage, so the supervisor cannot observe their token spend.
   */
  usage: TokenUsage
  /** True when a guardrail (subtask cap or token budget) stopped work early. */
  stoppedEarly: boolean
}

/**
 * Decomposes a task into subtasks. The mechanism is yours — an LLM planner
 * (see `agentPlanner`), a static list, or hand-rolled logic. Autopilot owns
 * the control policy around it, not the decomposition.
 */
export type Planner = (task: string) => Subtask[] | Promise<Subtask[]>

/**
 * Routes a subtask to the worker agent that should run it. Built from the
 * `workers` option: a single `Agent`, a `Record<string, Agent>` keyed by
 * `subtask.worker`, or a function for custom routing.
 */
export type WorkerRouter = (subtask: PlannedSubtask) => Agent

/** Combines the subtask results into the final answer. */
export type Synthesizer = (task: string, results: SubtaskResult[]) => string | Promise<string>

/** Progress events emitted during a run (for logging / UI). */
export type SupervisorEvent =
  | { type: 'plan'; task: string; subtasks: PlannedSubtask[] }
  | { type: 'plan-trimmed'; kept: number; dropped: number; reason: 'maxSubtasks' }
  | { type: 'dispatch-start'; subtask: PlannedSubtask }
  | { type: 'dispatch-result'; result: SubtaskResult }
  | { type: 'budget-exceeded'; spentTokens: number; limitTokens: number; skipped: number }
  | { type: 'synthesize'; results: SubtaskResult[] }

export interface SupervisorOptions {
  /** How to decompose the task into subtasks. */
  plan: Planner
  /**
   * The worker agent(s) that run subtasks:
   * - a single `Agent` — every subtask runs on it;
   * - a `Record<string, Agent>` — `subtask.worker` selects the agent;
   * - a `WorkerRouter` function — full control.
   */
  workers: Agent | Record<string, Agent> | WorkerRouter
  /**
   * How to combine results into the final answer. Defaults to a plain
   * concatenation of the successful results; pass `agentSynthesizer(agent)`
   * for an LLM synthesis.
   */
  synthesize?: Synthesizer
  /** Max subtasks dispatched at once. Positive integer; default 4. */
  concurrency?: number
  /**
   * Optional hard cap on subtasks. A longer plan is trimmed to this many and a
   * `plan-trimmed` event is emitted; omit for no cap. Positive integer.
   */
  maxSubtasks?: number
  /**
   * Optional token guardrail. When `maxTotalTokens` is set, the supervisor stops
   * dispatching new subtasks once aggregate dispatch usage crosses it (in-flight
   * workers still finish, so usage can overshoot slightly). Omit for no limit.
   */
  budget?: { maxTotalTokens?: number }
  /**
   * Observe progress events. The callback is isolated: if it throws, the error
   * is logged and the run continues, so an observer bug cannot abort the run.
   */
  onEvent?: (event: SupervisorEvent) => void
}
