/**
 * `@gemstack/the-framework` — **The (AI) Framework**: turnkey, zero-config AI
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
  type RunFrameworkOptions,
  type RunFrameworkResult,
  type DeployDecision,
  type ServeConfig,
  type AppPreview,
} from './run.js'
export {
  requestChoices,
  requestMultiSelect,
  resolveAwaitGate,
  type ChoicesOption,
  type ChoicesDeps,
  type MultiSelectOption,
  type MultiSelectDeps,
} from './await-gate.js'
export { snapshotWorkspace, SANDBOX_IGNORE, type SnapshotOptions } from './sandbox.js'
export {
  parseResetsAt,
  boundaryFromResetsAt,
  quotaBoundaryStatus,
  QUOTA_WEEK_MS,
  type QuotaBoundary,
  type BoundaryWindow,
  type QuotaBoundaryStatus,
} from './quota-boundary.js'
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
  type OnBeforeMergeableSkip,
  pickedIds,
  OPEN_LOOP_MODES,
} from './events.js'
export { formatFrameworkEvent } from './terminal.js'
export { resolveSessionLink, hasSessionIdPlaceholder, SESSION_ID_PLACEHOLDER } from './session-link.js'
export {
  loopStatus,
  sessionInfo,
  runProgress,
  handoffState,
  type LoopStatus,
  type SessionInfo,
  type RunProgress,
  type HandoffState,
} from './run-view.js'
export {
  assessRepo,
  planMaintenanceSweep,
  maintainSweep,
  readMaintenanceState,
  writeMaintenanceState,
  mergeMaintenanceState,
  maintenanceDue,
  maintenanceStatePath,
  MAINTENANCE_FILE,
  DEFAULT_MAINTENANCE_INTERVAL_MS,
  type MaintenanceState,
  type RepoReview,
  type MaintenanceAction,
  type SweepSummary,
  type SweepDeps,
  type MaintenanceFs,
} from './maintenance.js'
export { startDashboard, summarizeProject, defaultProjectsProvider, readDocs, type Dashboard, type DashboardOptions, type StartRunKind, type StartRunResult, type AddProjectResult, type OnboardingSuggestion, type PreviewResult, type PreviewStatus, type RunWorktree, type ProjectSummary, type ProjectsProvider, type SummarizeDeps, type WorkspaceDoc, readTickets, type WorkspaceTicket, type ProjectQueue, type QueueItem, type Overview, type ActiveRun, type RecentProject, type RecentRun, buildRecentRuns, type HotTicket, type HotBucket, buildHotTickets, type DashboardData, type ProjectStat, type ActivityDay, type GitStatus, type LinkedPr, type FileDiff, type FileChange, type FileContent, type RunHandoff, type HandoffCommit, type HandoffFile, type HandoffResult, buildInterventions, type Intervention, type OpenPr, type PrLister, type InterventionsDeps, buildActivity, activityKey, pickNewActivity, type Activity, type ActivityDeps } from './dashboard/index.js'
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
  conversationPath,
  conversationsDir,
  renderMessage,
  parseConversation,
  appendMessage,
  readConversation,
  listConversations,
  ensureConversationsIgnored,
  CONVERSATIONS_DIR,
  CONVERSATIONS_GITIGNORE,
  type ConversationMessage,
  type ConversationRole,
} from './conversations.js'
export {
  startConversationCommitter,
  commitConversations,
  pendingConversations,
  gitBusy,
  commitMessage,
  nodePathProbe,
  CONVERSATIONS_PATHSPEC,
  COMMIT_POLL_MS,
  COMMIT_MAX_WAIT_MS,
  type ConversationCommitter,
  type ConversationCommitterOptions,
  type CommitOutcome,
  type PathProbe,
} from './conversation-commit.js'
export {
  theFrameworkDir,
  isActivated,
  nodeProjectFs,
  crawlRepoFiles,
  isGitRepo,
  nodeGitRunner,
  gitTimeoutMs,
  GIT_READ_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  GIT_SLOW_TIMEOUT_MS,
  readProjectSignals,
  type ProjectFs,
  type GitRunner,
} from './project.js'
export { CliTimeoutError, isCliTimeout, type CliTimeout } from './cli-exec.js'
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
  readProjectPreferences,
  writeProjectPreferences,
  resolvePreferences,
  registryPreferencesStore,
  sanitizeCustomPresets,
  REGISTRY_FILE,
  PROJECT_PREFERENCE_KEYS,
  type ProjectRecord,
  type Registry,
  type Preferences,
  type ProjectPreferences,
  type PreferencesStore,
  type CustomPreset,
  type RegistryFs,
} from './registry.js'
export {
  readProjectPresets,
  writeProjectPresets,
  PROJECT_PRESETS_FILE,
} from './project-presets.js'
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
  resolveConfigKey,
  resolveRunConfig,
  resolvedModes,
  fileConfigLayer,
  describeResolvedConfig,
  RUN_CONFIG_DEFAULTS,
  type ConfigLayer,
  type RunConfigValues,
  type ResolvedRunConfig,
} from './config-layers.js'
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
  writeDaemonState,
  startDaemonStateHeartbeat,
  isProcessAlive,
  EventTailer,
  DAEMON_STATE_FILE,
  DAEMON_STATE_HEARTBEAT_MS,
  DEFAULT_DAEMON_PORT,
  type DaemonState,
  type DaemonStateHeartbeat,
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
  TODO_FORMAT_FILE,
  DEFAULT_MAX_TODO_ITEMS,
  type TodoBacklog,
  type TodoLoopOptions,
  type TodoLoopResult,
  type TodoLoopReason,
} from './todo-loop.js'
export { runOptionsFromPreferences, autopilotEnabled, preferencesFromFileConfig } from './run-options.js'
export {
  startAutoPm,
  AUTO_PM_JOBS,
  AUTO_PM_MAINTENANCE_JOB,
  autoPmDecision,
  quotaHeadroom,
  DEFAULT_AUTO_PM_INTERVAL_MS,
  DEFAULT_AUTO_PM_COOLDOWN_MS,
  type AutoPmInputs,
  type AutoPmDecision,
  type AutoPmDeps,
  type AutoPmLoop,
  type AutoPmProject,
  type AutoPmJob,
} from './auto-pm.js'
export {
  PRESETS,
  PRESET_DIR,
  presetFilePath,
  presetContext,
  materializePresets,
} from './presets.js'
export { presets, LAUNCHER_PRESETS, type PresetKey } from './preset-catalog.js'
export { NOTIFICATION_DEFAULTS, notificationEnabled, discordNotificationEnabled } from './preference-defaults.js'
export { interventionKey, pickNewInterventions } from './dashboard/keys.js'
export { definePreset, defaultWhat, DEFAULT_WHAT, type PresetDef, type PresetParam, type PresetRenderContext } from './preset-prompt.js'
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
