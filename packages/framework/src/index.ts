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
  reArchitect,
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
  requestChoices,
  requestMultiSelect,
  resolveAwaitGate,
  type RunFrameworkOptions,
  type RunFrameworkResult,
  type DeployDecision,
  type ServeConfig,
  type AppPreview,
  type ChoicesOption,
  type ChoicesDeps,
  type MultiSelectOption,
  type MultiSelectDeps,
} from './run.js'
export { snapshotWorkspace, SANDBOX_IGNORE, type SnapshotOptions } from './sandbox.js'
export {
  startRelay,
  relayPublisher,
  type Relay,
  type RelayOptions,
  type RelayPublisher,
} from './relay.js'
export {
  discoverExtensions,
  readProjectSignals,
  type DiscoverExtensionsResult,
} from './extensions.js'
export { hostExecutor, type HostExecutorOptions } from './host-exec.js'
export {
  type FrameworkEvent,
  type ChoiceOption,
  type ChoiceRequest,
  type ChoicePick,
  type ChoiceBy,
  pickedIds,
  formatFrameworkEvent,
  resolveSessionLink,
  hasSessionIdPlaceholder,
  SESSION_ID_PLACEHOLDER,
  OPEN_LOOP_MODES,
} from './events.js'
export {
  architectPlan,
  decisionLedger,
  loopStatus,
  sessionInfo,
  runProgress,
  type ArchitectPlan,
  type Decision,
  type LoopStatus,
  type SessionInfo,
  type RunProgress,
} from './run-view.js'
export {
  assessRepo,
  planMaintenanceSweep,
  maintainSweep,
  readMaintenanceState,
  writeMaintenanceState,
  maintenanceStatePath,
  MAINTENANCE_FILE,
  type MaintenanceState,
  type RepoReview,
  type MaintenanceAction,
  type SweepSummary,
  type SweepDeps,
  type MaintenanceFs,
} from './maintenance.js'
export { startDashboard, summarizeProject, defaultProjectsProvider, readDocs, type Dashboard, type DashboardOptions, type StartRunKind, type StartRunResult, type AddProjectResult, type ProjectSummary, type ProjectsProvider, type SummarizeDeps, type WorkspaceDoc, type ProjectQueue, type QueueItem, type Overview, type ActiveRun, type RecentProject } from './dashboard/index.js'
export {
  RunStore,
  nodeStoreFs,
  applyEventToMeta,
  metaFromEvents,
  listRuns,
  loadRunEvents,
  runIdFromStartedAt,
  isSafeRunId,
  FRAMEWORK_DIR,
  EVENTS_FILE,
  META_FILE,
  RUNS_DIR,
  RUN_META_VERSION,
  type StoreFs,
  type RunMeta,
  type RunStatus,
  type OpenStoreOptions,
} from './store/index.js'
export {
  logsPath,
  gitignorePath,
  renderLogEntry,
  parseLogs,
  appendLog,
  readLogs,
  THE_FRAMEWORK_DIR,
  LOGS_FILE,
  LOGS_GITIGNORE,
  type LogEntry,
} from './logs.js'
export {
  theFrameworkDir,
  isActivated,
  nodeProjectFs,
  crawlRepoFiles,
  nodeGitRunner,
  type ProjectFs,
  type GitRunner,
} from './project.js'
export {
  projectId,
  registryPath,
  nodeRegistryFs,
  listProjects,
  addProject,
  removeProject,
  readRegistry,
  readPreferences,
  writePreferences,
  registryPreferencesStore,
  REGISTRY_FILE,
  type ProjectRecord,
  type Registry,
  type Preferences,
  type PreferencesStore,
  type RegistryFs,
} from './registry.js'
export {
  installProject,
  enumerateGitRepos,
  nodeDirLister,
  type InstallResult,
  type InstallDeps,
  type DirLister,
  type EnumerateDeps,
} from './install.js'
export {
  PACKAGE_NAME,
  nodeVersionFetcher,
  compareVersions,
  checkForUpdate,
  formatUpdateStatus,
  type VersionFetcher,
  type UpdateStatus,
} from './update-check.js'
export { runCli, parseArgs, buildDeployTarget, workspaceSummary, autoSelectPreset, runPostMergeSuite, promptRunArgs, POST_MERGE_PASSES, type PromptRunner, type CliIO, type CliOptions } from './cli.js'
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
  loadUserSystemPrompt,
  systemPromptBlock,
  renderSystemPrompt,
  SYSTEM_PROMPT_TEMPLATE,
  SYSTEM_PROMPT_FILE,
  BOOTSTRAP_PREAMBLE,
  type SystemPromptOptions,
  type TfContext,
  type RenderedSystemPrompt,
} from './system-prompt.js'
export { renderTemplate, TemplateFragmentError } from './prompt-template.js'
export {
  extractParamNames,
  renderPresetPrompt,
  unfilledParams,
  PresetParamError,
  PARAM_PATTERN,
  type PresetParam,
  type PresetParamOptions,
} from './preset-params.js'
export {
  preflight,
  type PreflightResult,
  type PreflightCheck,
  type PreflightOptions,
  type VersionProbe,
} from './preflight.js'
export {
  ensureDaemon,
  runDaemon,
  stopDaemon,
  daemonStatus,
  readDaemonState,
  isProcessAlive,
  EventTailer,
  DAEMON_STATE_FILE,
  DEFAULT_DAEMON_PORT,
  type DaemonState,
  type EnsureResult,
  type EnsureDaemonOptions,
  type RunDaemonOptions,
} from './daemon.js'
export {
  appendControl,
  resetControl,
  watchControl,
  controlPath,
  CONTROL_FILE,
  type ControlEntry,
  type ControlWatcher,
} from './control.js'
export { runPrompt, type RunPromptOptions, type RunPromptResult } from './prompt-run.js'
export {
  runTodoLoop,
  findTodoBacklog,
  parseTodoEntries,
  TODO_FILE_PATTERN,
  FLAT_TODO_FILE,
  DEFAULT_MAX_TODO_ITEMS,
  type TodoBacklog,
  type TodoLoopOptions,
  type TodoLoopResult,
  type TodoLoopReason,
} from './todo-loop.js'
export {
  renderResearchPrompt,
  RESEARCH_PRESET_NAME,
  RESEARCH_PROMPT_TEMPLATE,
  RESEARCH_PARAMS,
} from './research-preset.js'
export {
  renderReadabilityPrompt,
  READABILITY_PRESET_NAME,
  READABILITY_PROMPT_TEMPLATE,
  READABILITY_PARAMS,
} from './readability-preset.js'
export {
  renderMaintainabilityPrompt,
  MAINTAINABILITY_PRESET_NAME,
  MAINTAINABILITY_PROMPT_TEMPLATE,
  MAINTAINABILITY_PARAMS,
} from './maintainability-preset.js'
export {
  renderSecurityAuditPrompt,
  SECURITY_AUDIT_PRESET_NAME,
  SECURITY_AUDIT_PROMPT_TEMPLATE,
  SECURITY_AUDIT_PARAMS,
} from './security-audit-preset.js'
export {
  renderUxPrompt,
  UX_PRESET_NAME,
  UX_PROMPT_TEMPLATE,
  UX_PARAMS,
} from './ux-preset.js'
export {
  fakeDriver,
  FAKE_INTENT,
  FAKE_SIGNALS,
  FAKE_DEPLOY,
} from './fake-script.js'
