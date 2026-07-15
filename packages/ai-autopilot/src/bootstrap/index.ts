/**
 * Bootstrap mode — the spine from nothing to a running, production-grade app.
 *
 * {@link Bootstrap} sequences the injected {@link BootstrapSteps} into
 * scope → build → full-fledged loop, narrating each phase. The default step
 * builders wire those steps onto the real primitives (Supervisor, the Loop); a
 * test swaps in stubs + a `FakeRunner` to run the whole flow offline.
 *
 * - {@link Bootstrap} / {@link createBootstrap} — the orchestrator
 * - {@link supervisorBuild} — build step over the {@link Supervisor}
 * - {@link loopChecklist} / {@link loopImprove} — the full-fledged loop steps
 */
export { Bootstrap, createBootstrap, BootstrapAborted } from './bootstrap.js'
export {
  supervisorBuild,
  loopChecklist,
  loopImprove,
  type SupervisorBuildOptions,
  type LoopStepOptions,
  type LoopChecklistOptions,
  type LoopImproveOptions,
} from './steps.js'
export {
  agentDeploy,
  planOnlyTarget,
  FakeDeployTarget,
  DEFAULT_DEPLOY_TARGETS,
  type AgentDeployOptions,
  type FakeDeployTargetOptions,
} from './deploy.js'
export { serveCheck, mergeChecklists, type ServeCheckOptions } from './serve-check.js'
export {
  cloudflareTarget,
  type CloudflareTargetOptions,
  type CloudflareProduct,
  type DeployExecutor,
} from './cloudflare.js'
export { dokployTarget, type DokployTargetOptions, type FetchLike } from './dokploy.js'
export type {
  BootstrapScope,
  BootstrapPhase,
  ScopeAnswer,
  RenderMode,
  DeployPlan,
  DeployResult,
  DeployOutcome,
  DeployTarget,
  DeployTargetContext,
  BootstrapEvent,
  BootstrapResult,
  BootstrapSteps,
  BootstrapOptions,
  BuildContext,
  DeployContext,
  LoopPassContext,
} from './types.js'
