export { startDashboard, type Dashboard, type DashboardOptions } from './server.js'
export type { StartRunKind, StartRunOptions, StartRunResult, AddProjectResult, OnboardingSuggestion, PreviewResult, PreviewStatus, RunWorktree } from './types.js'
export {
  summarizeProject,
  defaultProjectsProvider,
  singleProjectProvider,
  emptyProjectsProvider,
  type ProjectSummary,
  type ProjectsProvider,
  type SummarizeDeps,
} from './projects.js'
export { resolveDashboardBundle } from './bundle.js'
export { makeTelefuncMount, isSameOriginRequest, type EventsSource } from './telefunc-serve.js'
export { serveClientBundle } from './static.js'
export { readDocs, DOC_CATEGORIES, type WorkspaceDoc } from './docs.js'
export { readTickets, readTicket, readTicketsMeta, type WorkspaceTicket, type WorkspaceTicketDetail, type TicketsMeta, type TicketGithubLink } from './tickets.js'
export { collectQueue, parseTodoItems, type ProjectQueue, type QueueItem } from './queue.js'
export { buildOverview, buildRecentRuns, buildHotTickets, collectAllTickets, ticketBucket, type Overview, type ActiveRun, type RecentProject, type RecentRun, type HotTicket, type HotBucket, type OverviewDeps, type ProjectTickets, type AllTicketsDeps } from './overview.js'
export { buildDashboard, type DashboardData, type ProjectStat, type ActivityDay, type DashboardDeps } from './dashboard.js'
export { readGitStatus, type GitStatus } from './git-status.js'
export { ghPrView, ghPrList, ghJson, nodeGhRunner, type LinkedPr, type OpenPr, type PrLookup, type BranchPrLookup, type PrLister, type GhRunner } from './gh.js'
export { readFileDiff, readFileChanges, safeRepoPath, type FileDiff, type FileChange } from './file-diff.js'
export { readFileContent, type FileContent } from './file-read.js'
export {
  readRunHandoff,
  runBranchFor,
  pushRunBranch,
  openRunPullRequest,
  type RunHandoff,
  type HandoffCommit,
  type HandoffFile,
  type HandoffResult,
  type PullRequestDraft,
  type RunHandoffDeps,
} from './run-handoff.js'
export {
  buildInterventions,
  interventionKey,
  pickNewInterventions,
  interventionLine,
  postInterventionsDiscord,
  type Intervention,
  type InterventionsDeps,
} from './interventions.js'
export { buildActivity, activityKey, pickNewActivity, activityLine, postActivityDiscord, type Activity, type ActivityDeps } from './activity.js'
export { startKeyedWatcher, SeenTracker, type KeyedWatcher, type KeyedWatcherOptions } from './keyed-watcher.js'
export { BRIDGE_PREFIX, handleBridgeRequest, type BridgeHandlers, type BridgeQuestion, type BridgeSession, type BridgeEvent, type BridgeHello, type BridgeStart } from './bridge-endpoints.js'
export { bridgeSessionsFrom, BRIDGE_SESSION_WINDOW_MS, BRIDGE_SESSION_LIMIT } from './bridge-sessions.js'
export { bridgeQuestions, resetBridgeQuestions, BridgeQuestions, type BridgeContact, type BridgeAnswer } from './bridge-store.js'
export { bridgeStarts, resetBridgeStarts, BridgeStarts, START_CLAIM_TTL_MS, type BridgeStartRequest, type BridgeStartState, type BridgeStartInput } from './bridge-starts.js'
