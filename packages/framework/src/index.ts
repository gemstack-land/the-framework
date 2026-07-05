/**
 * `@gemstack/framework` — **The (AI) Framework**: turnkey, zero-config AI
 * orchestration. It wraps a coding-agent CLI (Claude Code today) as a **black
 * box** and takes a user from an idea to a running app, with a localhost
 * dashboard that foregrounds the orchestration the agent's own chat cannot show.
 *
 * The whole product is built on `@gemstack/ai-autopilot`'s already-shipped
 * spine (bootstrap, the loop, the decisions ledger, presets, deploy targets);
 * this package adds the two missing pieces from #166: the **driver** seam that
 * wraps the agent, and the **product shell** (CLI + dashboard) that drives it.
 *
 * ## Driver seam
 * The one abstraction we wrap a coding-agent CLI behind. We prompt it, let its
 * own loop run, read the code, and gate on the outcome (guardrail: the seam is
 * the code, never the agent's tool calls). Swappable, so Codex / opencode slot
 * in behind the same three methods.
 *
 * - {@link Driver} / {@link DriverSession} — the contract
 * - {@link ClaudeCodeDriver} — the first real driver (`claude -p` stream-json)
 * - {@link FakeDriver} — deterministic offline driver for `--fake` / tests
 *
 * ## Driver-backed steps
 * ai-autopilot's `Bootstrap` steps, re-implemented to run everything *through*
 * the driver (option A): the architect is a structured JSON decision, build /
 * improve are prompts, the checklist gates on the `{ blockers }` verdict.
 *
 * - {@link driverArchitect} / {@link driverBuild} / {@link driverChecklist} / {@link driverImprove}
 *
 * ## Run + product shell
 * - {@link runFramework} — detect the preset, frame the agent with its personas,
 *   drive the whole bootstrap flow, and stream {@link FrameworkEvent}s
 * - {@link startDashboard} — the localhost UI over the event stream
 * - {@link runCli} / {@link parseArgs} — the `framework` command
 */
export * from './driver/index.js'
export {
  driverArchitect,
  driverBuild,
  driverChecklist,
  driverImprove,
  decideDeploy,
  deployWith,
  parseArchitectPlan,
  architectPrompt,
  buildPrompt,
  extendPrompt,
  improvePrompt,
  PRODUCTION_GRADE_PROMPT,
  isWorkspaceEmpty,
  type DriverStepOptions,
} from './steps.js'
export {
  runFramework,
  type RunFrameworkOptions,
  type RunFrameworkResult,
  type DeployDecision,
  type ServeConfig,
  type AppPreview,
} from './run.js'
export {
  discoverExtensions,
  readProjectSignals,
  type DiscoverExtensionsResult,
} from './extensions.js'
export { hostExecutor, type HostExecutorOptions } from './host-exec.js'
export {
  type FrameworkEvent,
  formatFrameworkEvent,
  resolveSessionLink,
  hasSessionIdPlaceholder,
  SESSION_ID_PLACEHOLDER,
} from './events.js'
export { startDashboard, dashboardHtml, type Dashboard, type DashboardOptions } from './dashboard/index.js'
export {
  RunStore,
  nodeStoreFs,
  applyEventToMeta,
  metaFromEvents,
  FRAMEWORK_DIR,
  EVENTS_FILE,
  META_FILE,
  RUN_META_VERSION,
  type StoreFs,
  type RunMeta,
  type RunStatus,
  type OpenStoreOptions,
} from './store/index.js'
export { runCli, parseArgs, buildDeployTarget, workspaceSummary, autoSelectPreset, type CliIO, type CliOptions } from './cli.js'
export {
  metaSelect,
  metaSelectPrompt,
  parseMetaSelection,
  presetCatalog,
  META_SELECT_MODES,
  META_SELECT_SYSTEM,
  type MetaSelection,
  type PresetCatalogEntry,
} from './meta-select.js'
export {
  loadFrameworkConfig,
  parseFrameworkConfig,
  FRAMEWORK_CONFIG_FILES,
  type FrameworkFileConfig,
} from './config.js'
export {
  loadRepoMemory,
  memoryFraming,
  MEMORY_FILES,
  type MemoryFile,
  type LoadedMemory,
} from './memory.js'
export {
  preflight,
  type PreflightResult,
  type PreflightCheck,
  type PreflightOptions,
  type VersionProbe,
} from './preflight.js'
export {
  fakeDriver,
  FAKE_INTENT,
  FAKE_SIGNALS,
  FAKE_DEPLOY,
} from './fake-script.js'
