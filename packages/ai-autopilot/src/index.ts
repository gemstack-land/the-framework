/**
 * `@gemstack/ai-autopilot` — orchestration for `@gemstack/ai-sdk` agents.
 *
 * The seed slice is the supervisor/worker topology: {@link Supervisor} plans a
 * task into subtasks, dispatches them to worker agents (bounded concurrency +
 * token budget + per-subtask error isolation), and synthesizes the result.
 *
 * Autopilot owns the *control policy* over many agent runs; `ai-sdk` owns the
 * single-agent loop and the handoff / subagent primitives the policy builds on.
 *
 * - {@link Supervisor} — the plan → dispatch → synthesize orchestrator
 * - {@link agentPlanner} — turn a planning agent into a {@link Planner}
 * - {@link agentSynthesizer} / {@link defaultSynthesize} — combine results
 */
export { Supervisor } from './supervisor.js'
export { agentPlanner, type AgentPlannerOptions } from './planner.js'
export { agentSynthesizer, defaultSynthesize } from './synthesizer.js'
export type {
  Subtask,
  PlannedSubtask,
  SubtaskResult,
  SupervisorRun,
  SupervisorOptions,
  SupervisorEvent,
  Planner,
  WorkerRouter,
  Synthesizer,
} from './types.js'
