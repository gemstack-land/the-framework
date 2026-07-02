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
 * - {@link LocalRunner} — real host workspace (fs + child processes); the first real adapter
 * - {@link runnerTools} — expose a booted session to an agent as sandbox tools
 *
 * Surfaces run the same autopilot in the terminal, an in-page UI, or a
 * background process — all over the Supervisor's `onEvent` stream.
 *
 * - {@link terminalSink} — print events inline (terminal surface)
 * - {@link EventStream} — replayable multi-consumer event transport
 * - {@link launchAutopilot} — a detached background run handle
 *
 * Decisions are the durable memory layer: a ledger of the project's rejected
 * ideas and settled choices, so a run stops re-pitching what was already turned
 * down. It round-trips a human-editable `DECISIONS.md`.
 *
 * - {@link DecisionLedger} — record decisions, consult before proposing
 * - {@link loadLedger} / {@link saveLedger} — persist to `DECISIONS.md`
 * - {@link decisionTools} / {@link decisionBriefing} — expose it to an agent
 *
 * The loop is the event-to-prompt-chain policy: the agent declares a semantic
 * change (a {@link LoopEvent}) and the right follow-up prompts fire — a major
 * change runs review + code-quality + security, a new UI flow runs QA + UX.
 *
 * - {@link Loop} — match an event to a prompt chain and run it (N fresh passes)
 * - {@link definePrompt} / {@link defineRule} — author prompts and policy rules
 * - {@link defaultLoopRules} — the built-in web-app policy
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
  LocalRunner,
  LocalRunnerSession,
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
  type LocalRunnerOptions,
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
export {
  defineDecision,
  DecisionError,
  slugify,
  DecisionLedger,
  createLedger,
  parseDecisions,
  serializeDecisions,
  loadLedger,
  saveLedger,
  nodeLedgerFs,
  DECISIONS_FILE,
  decisionTools,
  decisionBriefing,
  type ConsultOptions,
  type LedgerFs,
  type DecisionToolsOptions,
  type Decision,
  type DecisionSpec,
  type DecisionStatus,
  type DecisionMatch,
} from './decisions/index.js'
export {
  definePrompt,
  defineRule,
  LoopError,
  Loop,
  createLoop,
  defaultLoopRules,
  LOOP_EVENTS,
  LOOP_PROMPTS,
  type LoopOptions,
  type LoopEvent,
  type LoopContext,
  type LoopPrompt,
  type LoopPromptSpec,
  type LoopRule,
  type LoopRuleSpec,
  type PassResult,
  type PromptOutcome,
  type LoopRunResult,
  type LoopProgress,
} from './loop/index.js'
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
