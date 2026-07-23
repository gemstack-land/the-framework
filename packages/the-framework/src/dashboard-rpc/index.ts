// The dashboard's Telefunc surface (#405), served in-process by the daemon. The
// implementations live here in @gemstack/the-framework so `sendStart` (added with the serve
// wiring) can reach the daemon's `startRun`; the framework-dashboard client imports
// these through thin re-export shims so the baked RPC keys stay `/server/*.telefunc.ts`.
export { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onTickets, onRetainedWorktrees, onRunWorktree, onRunHandoff, onSystemPromptUser } from './reads.telefunc.js'
export { sendStop, sendChoice, sendMessage, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp, sendRemoveWorktree, sendDeleteSession, sendPushBranch, sendOpenPullRequest, sendQueueTicket, type QueueTicketResult } from './control.telefunc.js'
export { onEvents } from './events.telefunc.js'
export { onProjects, sendAddProject } from './projects.telefunc.js'
export {
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
  onProjectPresets,
  saveProjectPresets,
  onEditors,
  onNotifyChannels,
  type SavePreferencesResult,
  type NotifyChannels,
} from './preferences.telefunc.js'
export { type EditorInfo } from '../dashboard/open-in-app.js'
export { onQuota } from './quota.telefunc.js'
export { checkDevices, type DeviceCheck } from './devices.telefunc.js'
export { registerDashboardTelefunctions, DASHBOARD_TELEFUNC_KEYS } from './register.js'
