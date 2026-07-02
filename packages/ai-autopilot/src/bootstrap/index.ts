/**
 * Bootstrap mode — the spine from nothing to a running, production-grade app.
 *
 * {@link Bootstrap} sequences the injected {@link BootstrapSteps} into
 * scope → architect → build → full-fledged loop, narrating each phase and
 * recording the architect's choices to the decisions ledger. The default step
 * builders wire those steps onto the real primitives (Supervisor, personas, the
 * Loop); a test swaps in stubs + a `FakeRunner` to run the whole flow offline.
 *
 * - {@link Bootstrap} / {@link createBootstrap} — the orchestrator
 * - {@link agentArchitect} — architect step over an `ai-sdk` agent
 * - {@link supervisorBuild} — build step over the {@link Supervisor}
 * - {@link loopChecklist} / {@link loopImprove} — the full-fledged loop steps
 */
export { Bootstrap, createBootstrap, BootstrapAborted } from './bootstrap.js'
export {
  agentArchitect,
  supervisorBuild,
  loopChecklist,
  loopImprove,
  type ArchitectAgentOptions,
  type SupervisorBuildOptions,
  type LoopStepOptions,
  type LoopChecklistOptions,
  type LoopImproveOptions,
} from './steps.js'
export type {
  BootstrapScope,
  BootstrapPhase,
  ScopeAnswer,
  ArchitectDecision,
  ArchitectPlan,
  BootstrapEvent,
  BootstrapResult,
  BootstrapSteps,
  BootstrapOptions,
  BuildContext,
  ArchitectContext,
  LoopPassContext,
} from './types.js'
