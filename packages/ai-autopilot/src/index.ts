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
 * The runner is the pluggable execution seam: a workspace (filesystem + shell +
 * optional preview) where autopilot builds and runs an app. Shaped after Flue's
 * `sandbox` so WebContainer / Docker / Flue drop in behind one interface.
 *
 * - {@link FakeRunner} — in-memory runner for tests
 * - {@link LocalRunner} — real host workspace (fs + child processes); the first real adapter
 * - {@link DockerRunner} — sandboxed workspace in a container (via the `docker` CLI)
 * - {@link WebContainerRunner} — sandboxed workspace in the browser (via `@webcontainer/api`)
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
 * - {@link LoopEngine} — match an event to a prompt chain and run it (N fresh passes)
 * - {@link definePrompt} / {@link defineLoop} — author prompts and policy loops
 * - {@link defaultLoops} — the built-in web-app policy
 * - {@link parseVerdict} / {@link isPassing} — the `{ blockers }` verdict the loop
 *   gates on, so it stops on a review's *outcome*, not just execution
 *
 * The prompts library supplies the loop's prompt *bodies* as data (stack-aware
 * markdown): review, code-quality, security, refactor, UX, QA, knowledge-base,
 * and the `production-grade` checklist bootstrap's full-fledged loop repeats
 * against.
 *
 * - {@link builtinLibrary} — load the shipped, stack-aware prompt bodies
 * - {@link loopPromptsFor} — materialize a library into loop prompts by id
 * - {@link promptInstructions} — compose a body with the decisions briefing
 *
 * Bootstrap mode is the spine that sequences all of the above into one flow:
 * scope → build → full-fledged loop, taking a user from nothing to a
 * running, production-grade app. It narrates each phase and repeats the
 * production-grade checklist until its `{ blockers }` verdict is empty.
 *
 * - {@link Bootstrap} — the orchestrator over the injectable steps
 * - {@link supervisorBuild} — the default build step wiring
 * - {@link loopChecklist} / {@link loopImprove} — the full-fledged loop steps
 * - {@link agentDeploy} + the {@link DeployTarget} seam ({@link planOnlyTarget},
 *   {@link FakeDeployTarget}, {@link cloudflareTarget}, {@link dokployTarget}) — the
 *   final phase: decide SSR/SSG/SPA + target and narrate, then ship via a real adapter
 *
 * Scale mode keeps a compact `CODE-OVERVIEW.md` the agent reads first in a large
 * repo, refreshed only on *material* change (build tooling, test framework, a
 * directory restructure) so the map never rots or churns.
 *
 * - {@link CodeOverviewMaintainer} — holds the map, refreshes on material change
 * - {@link detectMaterialChange} — the deterministic refresh trigger
 * - {@link agentOverview} / {@link overviewLoopPrompt} — regenerate with an agent,
 *   and wire the maintainer into the loop
 *
 * Presets are the web-app layer: detect the app's framework (Vike flagship,
 * Next.js second), on top of the agnostic core. A preset is a pure detector.
 *
 * - {@link PresetRegistry} — register presets, {@link PresetRegistry.select} one
 * - {@link detectFramework} — score a project's deps/files against presets
 * - {@link vikePreset} / {@link nextPreset} — the built-ins
 *
 * Domain presets are the Open Loop bundle unit (#204): one selectable, composable
 * bundle of {loops, prompts}. Author in code or load a directory of `.md` files;
 * compose several into one (presets-of-presets). Distinct from the framework
 * `Preset` above — this is the user-picked domain, not a detector.
 *
 * - {@link defineDomainPreset} / {@link loadDomainPreset} — author, or load from a directory
 * - {@link composeDomainPresets} — merge presets into one (later wins on prompt id)
 * - {@link builtinDomainPresets} / {@link loadDomainPresetsFrom} — enumerate a set (the picker primitive)
 * - {@link selectPreset} — pick the user's chosen domain by name
 * - {@link softwareDevelopmentPreset} — the stack-agnostic default of the five shipped presets
 * - {@link loadDomainPreset} `{ modes }` — activate Autopilot/Technical variants
 *   ({@link selectWinners}): a `conditions` sibling `.md` overrides its base
 */
export { Supervisor } from './supervisor.js'
export { agentPlanner, type AgentPlannerOptions } from './planner.js'
export { agentSynthesizer, defaultSynthesize, type AgentSynthesizerOptions } from './synthesizer.js'
export {
  FakeRunner,
  FakeRunnerSession,
  LocalRunner,
  LocalRunnerSession,
  DockerRunner,
  DockerRunnerSession,
  dockerAvailable,
  WebContainerRunner,
  WebContainerRunnerSession,
  webContainerAvailable,
  RunnerError,
  runnerTools,
  type Runner,
  type RunnerSession,
  type RunnerFs,
  type FileTree,
  type BootOptions,
  type ExecOptions,
  type ExecResult,
  type RunnerProcess,
  type Preview,
  type PreviewOptions,
  type FakeRunnerOptions,
  type FakeExec,
  type RecordedExec,
  type RecordedStart,
  type LocalRunnerOptions,
  type DockerRunnerOptions,
  type WebContainerRunnerOptions,
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
  defineLoop,
  LoopError,
  LoopEngine,
  createLoopEngine,
  defaultLoops,
  LOOP_EVENTS,
  LOOP_PROMPTS,
  parseVerdict,
  isPassing,
  type Verdict,
  type LoopEngineOptions,
  type LoopEvent,
  type LoopContext,
  type LoopPrompt,
  type LoopPromptSpec,
  type Loop,
  type LoopSpec,
  type PassResult,
  type PromptOutcome,
  type LoopRunResult,
  type LoopProgress,
} from './loop/index.js'
export {
  parsePrompt,
  PromptError,
  PromptLibrary,
  builtinPrompts,
  builtinLibrary,
  builtinPromptsDir,
  loadPromptsFrom,
  promptInstructions,
  renderTask,
  toLoopPrompt,
  loopPromptsFor,
  type Prompt,
  type MakePromptAgent,
  type PromptAgentContext,
} from './prompts/index.js'
export {
  Bootstrap,
  createBootstrap,
  BootstrapAborted,
  supervisorBuild,
  loopChecklist,
  loopImprove,
  agentDeploy,
  planOnlyTarget,
  FakeDeployTarget,
  DEFAULT_DEPLOY_TARGETS,
  serveCheck,
  mergeChecklists,
  cloudflareTarget,
  dokployTarget,
  type ServeCheckOptions,
  type CloudflareTargetOptions,
  type CloudflareProduct,
  type DeployExecutor,
  type DokployTargetOptions,
  type FetchLike,
  type SupervisorBuildOptions,
  type LoopStepOptions,
  type LoopChecklistOptions,
  type LoopImproveOptions,
  type AgentDeployOptions,
  type FakeDeployTargetOptions,
  type BootstrapScope,
  type BootstrapPhase,
  type ScopeAnswer,
  type RenderMode,
  type DeployPlan,
  type DeployResult,
  type DeployOutcome,
  type DeployTarget,
  type DeployTargetContext,
  type BootstrapEvent,
  type BootstrapResult,
  type BootstrapSteps,
  type BootstrapOptions,
  type BuildContext,
  type DeployContext,
  type LoopPassContext,
} from './bootstrap/index.js'
export {
  CodeOverviewMaintainer,
  createOverviewMaintainer,
  detectMaterialChange,
  agentOverview,
  overviewLoopPrompt,
  parseOverview,
  serializeOverview,
  loadOverview,
  saveOverview,
  nodeOverviewFs,
  OVERVIEW_FILE,
  type MaintainerOptions,
  type DetectOptions,
  type AgentOverviewOptions,
  type OverviewLoopPromptOptions,
  type CodeOverview,
  type OverviewSection,
  type MaterialChange,
  type OverviewFs,
  type RegenerateContext,
  type Regenerate,
  type OverviewRefresh,
  type OverviewEvent,
} from './overview/index.js'
export {
  definePreset,
  PresetError,
  detectFramework,
  vikePreset,
  nextPreset,
  builtinPresets,
  PresetRegistry,
  builtinPresetRegistry,
  type Preset,
  type PresetSpec,
  type PresetSignals,
  type FrameworkSignals,
  type PresetScore,
  type FrameworkDetection,
} from './presets/index.js'
export {
  defineDomainPreset,
  DomainPresetError,
  composeDomainPresets,
  selectPreset,
  loadDomainPreset,
  loadDomainPresetsFrom,
  builtinDomainPresets,
  loadLoopsFrom,
  builtinPresetsDir,
  softwareDevelopmentPreset,
  selectWinners,
  stemOf,
  readConditions,
  type LoadPresetOptions,
  type Conditional,
  type DomainPreset,
  type DomainPresetSpec,
  type DomainPresetMeta,
} from './preset/index.js'
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
