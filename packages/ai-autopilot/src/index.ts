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
 *
 * The runner is the pluggable execution seam: a workspace (filesystem + shell +
 * optional preview) where autopilot builds and runs an app. Shaped after Flue's
 * `sandbox` so WebContainer / Docker / Flue drop in behind one interface.
 *
 * - {@link FakeRunner} — in-memory runner for tests
 * - {@link runnerTools} — expose a booted session to an agent as sandbox tools
 *
 * Surfaces run the same autopilot in the terminal, an in-page UI, or a
 * background process — all over the Supervisor's `onEvent` stream.
 *
 * - {@link terminalSink} — print events inline (terminal surface)
 * - {@link EventStream} — replayable multi-consumer event transport
 * - {@link launchAutopilot} — a detached background run handle
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
export {
  FakeRunner,
  FakeRunnerSession,
  RunnerError,
  runnerTools,
  type Runner,
  type RunnerSession,
  type RunnerFs,
  type FileTree,
  type BootOptions,
  type ExecOptions,
  type ExecResult,
  type Preview,
  type PreviewOptions,
  type FakeRunnerOptions,
  type FakeExec,
  type RecordedExec,
  type RunnerToolsOptions,
} from './runner/index.js'
export {
  EventStream,
  formatEvent,
  terminalSink,
  launchAutopilot,
  type TerminalSinkOptions,
  type AutopilotHandle,
  type AutopilotStatus,
  type LaunchOptions,
} from './surface/index.js'
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
