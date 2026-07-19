/**
 * `@gemstack/framework` — **The (AI) Framework**: turnkey, zero-config AI
 * orchestration. It wraps a coding-agent CLI (Claude Code today) as a **black
 * box** and takes a user from an idea to a running app, with a localhost
 * dashboard that foregrounds the orchestration the agent's own chat cannot show.
 *
 * The whole product is built on `@gemstack/ai-autopilot`'s already-shipped
 * spine (bootstrap, the loop, presets, deploy targets);
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
 * the driver (option A): build / improve are prompts, the checklist gates on the
 * `{ blockers }` verdict.
 *
 * - {@link driverBuild} / {@link driverChecklist} / {@link driverImprove}
 *
 * ## Run + product shell
 * - {@link runFramework} — detect the preset, drive the whole bootstrap flow, and
 *   stream {@link FrameworkEvent}s
 * - {@link startDashboard} — the localhost UI over the event stream
 * - {@link runCli} / {@link parseArgs} — the `framework` command
 */
export * from './driver/index.js'
export {
  driverBuild,
  driverChecklist,
  driverImprove,
  decideDeploy,
  deployWith,
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
  ConsumptionMeter,
  consumptionStatus,
  budgetsFrom,
  DEFAULT_CONSUMPTION_LIMITS,
  FIVE_HOURS_MS,
  ONE_DAY_MS,
  type QuotaSample,
  type RollingConsumption,
  type ConsumptionLimit,
  type ConsumptionLimits,
  type ConsumptionBudgets,
  type ConsumptionWindow,
  type ConsumptionStatus,
  type LimitStatus,
  CONSUMPTION_LIMIT_LABEL,
} from './consumption.js'
export { startConsumptionGuard, type ConsumptionGuard, type StartConsumptionGuardOptions } from './consumption-guard.js'
export { pollerQuotaSource, defaultQuotaSource, type QuotaView, type QuotaSource } from './dashboard/quota.js'
export {
  QuotaPoller,
  DEFAULT_POLL_MS,
  MAX_POLL_MS,
  type QuotaEnvelope,
  type QuotaPollerOptions,
} from './quota-poller.js'
export {
  startRelay,
  relayPublisher,
  type Relay,
  type RelayOptions,
  type RelayPublisher,
} from './relay.js'
export { hostExecutor, type HostExecutorOptions } from './host-exec.js'
export {
  type FrameworkEvent,
  type ChoiceOption,
  type ChoiceRequest,
  type ChoicePick,
  type ChoiceBy,
  pickedIds,
  OPEN_LOOP_MODES,
} from './events.js'
export { formatFrameworkEvent } from './terminal.js'
export { resolveSessionLink, hasSessionIdPlaceholder, SESSION_ID_PLACEHOLDER } from './session-link.js'
export {
  loopStatus,
  sessionInfo,
  runProgress,
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
export { startDashboard, summarizeProject, defaultProjectsProvider, readDocs, type Dashboard, type DashboardOptions, type StartRunKind, type StartRunResult, type AddProjectResult, type PreviewResult, type PreviewStatus, type RunWorktree, type ProjectSummary, type ProjectsProvider, type SummarizeDeps, type WorkspaceDoc, type ProjectQueue, type QueueItem, type Overview, type ActiveRun, type RecentProject, type DashboardData, type ProjectStat, type ActivityDay, type GitStatus, type LinkedPr, type FileDiff, type FileChange, type FileContent, type RunHandoff, type HandoffCommit, type HandoffFile, type HandoffResult, buildInterventions, nodeGhPrLister, type Intervention, type OpenPr, type PrLister, type InterventionsDeps, buildActivity, activityKey, pickNewActivity, type Activity, type ActivityDeps } from './dashboard/index.js'
export { startPreview, detectDevScript, detectServeTargets, parsePreviewUrl, PREVIEW_SCRIPTS, type PreviewHandle, type StartPreviewOptions, type ServeTarget } from './preview.js'
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
  readProjectSignals,
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
  resolveConsumptionLimits,
  type Preferences,
  type PreferencesStore,
  type CustomPreset,
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
export { runCli, parseArgs, buildDeployTarget, runOnBeforeMergeable, promptRunArgs, type PromptRunner, type CliIO, type CliOptions } from './cli.js'
export { renderOnBeforeMergeablePrompt, ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE, type OnBeforeMergeableContext } from './on-before-mergeable-prompt.js'
export {
  loadFrameworkConfig,
  parseFrameworkConfig,
  FRAMEWORK_CONFIG_FILES,
  type FrameworkFileConfig,
} from './config.js'
export {
  systemPromptBlock,
  composeRunSystem,
  renderSystemPrompt,
  SYSTEM_PROMPT_TEMPLATE,
  type SystemPromptOptions,
  type RunSystemOptions,
  type TfContext,
  type RenderedSystemPrompt,
} from './system-prompt.js'
// Split out of system-prompt.js so the pure composition stays browser-safe (#520);
// re-exported here, so this entry's surface is unchanged.
export { loadUserSystemPrompt, SYSTEM_PROMPT_FILE } from './system-prompt-file.js'
export { renderTemplate, TemplateFragmentError } from './prompt-template.js'
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
export { RunMessageQueue, type RunMessages } from './run-messages.js'
export { runPrompt, type RunPromptOptions, type RunPromptResult } from './prompt-run.js'
export {
  runTodoLoop,
  findTodoBacklog,
  parseTodoEntries,
  TODO_FILE_PATTERN,
  FLAT_TODO_FILE,
  LEGACY_HYPHEN_TODO_FILE,
  LEGACY_TICKETS_TODO_FILE,
  LEGACY_TODO_FILE,
  TICKETS_DIR,
  TICKETING_FORMAT_FILE,
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
  renderSuggestNewTicketsPrompt,
  SUGGEST_NEW_TICKETS_PRESET_NAME,
  SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE,
  SUGGEST_NEW_TICKETS_PARAMS,
} from './suggest-new-tickets-preset.js'
export {
  renderSuggestTicketsToWorkOnPrompt,
  SUGGEST_TICKETS_TO_WORK_ON_PRESET_NAME,
  SUGGEST_TICKETS_TO_WORK_ON_PROMPT_TEMPLATE,
  SUGGEST_TICKETS_TO_WORK_ON_PARAMS,
} from './suggest-tickets-to-work-on-preset.js'
export {
  PRESETS,
  PRESET_DIR,
  presetFilePath,
  presetContext,
  materializePresets,
} from './presets.js'
export {
  fakeDriver,
  FAKE_INTENT,
  FAKE_SIGNALS,
  FAKE_DEPLOY,
} from './fake-script.js'
export {
  AGENTS,
  AGENT_SPECS,
  createDriver,
  isAgentName,
  type AgentName,
  type AgentSpec,
  type CreateDriverOptions,
} from './agent.js'
