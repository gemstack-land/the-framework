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
 *
 * Personas add the stack-aware knowledge layer: reusable roles that know the
 * GemStack stack (Vike + universal-orm), materialized into worker agents.
 *
 * - {@link definePersona} — define a stack-aware role
 * - {@link personaAgent} / {@link personaWorkers} — materialize personas for a run
 * - {@link personaRoster} — describe personas to a planner
 * - {@link stackPersonas} — the built-in Vike + universal-orm personas
 */
export { Supervisor } from './supervisor.js'
export { agentPlanner, type AgentPlannerOptions } from './planner.js'
export { agentSynthesizer, defaultSynthesize } from './synthesizer.js'
export {
  definePersona,
  PersonaError,
  personaInstructions,
  personaTools,
  personaAgent,
  personaWorkers,
  personaRoster,
  vikePageBuilder,
  universalOrmModeler,
  uiIntentDesigner,
  stackPersonas,
  type Persona,
  type PersonaSpec,
  type PersonaAgentOptions,
} from './personas/index.js'
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
