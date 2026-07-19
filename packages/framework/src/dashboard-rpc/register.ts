import { __decorateTelefunction } from 'telefunc'
import { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onRetainedWorktrees, onRunWorktree, onRunHandoff } from './reads.telefunc.js'
import { sendStop, sendChoice, sendMessage, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp, sendRemoveWorktree, sendPushBranch, sendOpenPullRequest } from './control.telefunc.js'
import { onEvents } from './events.telefunc.js'
import { onProjects, sendAddProject } from './projects.telefunc.js'
import { onPreferences, savePreferences, onEditors } from './preferences.telefunc.js'
import { onQuota } from './quota.telefunc.js'

// The client bakes each RPC key from the dashboard's source path (relative to its Vite
// root, keeping the `.ts` extension) as `"<telefuncFilePath>:<exportName>"`. Since the
// impls physically live here in @gemstack/framework (not in the dashboard), the no-Vite
// server can't discover them by file path — we register them under the exact baked keys
// via Telefunc's `__decorateTelefunction`. Keys live here so a rename is a one-liner.
export const DASHBOARD_TELEFUNC_KEYS = {
  reads: '/server/reads.telefunc.ts',
  control: '/server/control.telefunc.ts',
  events: '/server/events.telefunc.ts',
  projects: '/server/projects.telefunc.ts',
  preferences: '/server/preferences.telefunc.ts',
  quota: '/server/quota.telefunc.ts',
} as const

let registered = false

/**
 * Register the dashboard telefunctions under the client-baked keys (idempotent). The
 * `appRootDir` is cosmetic here — it is not part of the match key and shields are off
 * on the mount (see dashboard/telefunc-serve.ts).
 */
export function registerDashboardTelefunctions(appRootDir: string = process.cwd()): void {
  if (registered) return
  registered = true
  const reg = (fn: (...args: never[]) => unknown, name: string, key: string): void =>
    __decorateTelefunction(fn as never, name, key, appRootDir)
  const { reads, control, events, projects, preferences, quota } = DASHBOARD_TELEFUNC_KEYS
  reg(onRuns, 'onRuns', reads)
  reg(onRun, 'onRun', reads)
  reg(onDocs, 'onDocs', reads)
  reg(onProjectLog, 'onProjectLog', reads)
  reg(onQueue, 'onQueue', reads)
  reg(onOverview, 'onOverview', reads)
  reg(onInterventions, 'onInterventions', reads)
  reg(onActivity, 'onActivity', reads)
  reg(onDashboard, 'onDashboard', reads)
  reg(onGithubUrl, 'onGithubUrl', reads)
  reg(onGitStatus, 'onGitStatus', reads)
  reg(onRetainedWorktrees, 'onRetainedWorktrees', reads)
  reg(onRunWorktree, 'onRunWorktree', reads)
  reg(onRunHandoff, 'onRunHandoff', reads)
  reg(onProjectFiles, 'onProjectFiles', reads)
  reg(onProjectFileStatus, 'onProjectFileStatus', reads)
  reg(onFileDiff, 'onFileDiff', reads)
  reg(onRunChanges, 'onRunChanges', reads)
  reg(onFileContent, 'onFileContent', reads)
  reg(sendStop, 'sendStop', control)
  reg(sendChoice, 'sendChoice', control)
  reg(sendMessage, 'sendMessage', control)
  reg(sendStart, 'sendStart', control)
  reg(sendPreview, 'sendPreview', control)
  reg(onServeTargets, 'onServeTargets', control)
  reg(sendStopPreview, 'sendStopPreview', control)
  reg(onPreviewStatus, 'onPreviewStatus', control)
  reg(sendOpenInApp, 'sendOpenInApp', control)
  reg(sendRemoveWorktree, 'sendRemoveWorktree', control)
  reg(sendPushBranch, 'sendPushBranch', control)
  reg(sendOpenPullRequest, 'sendOpenPullRequest', control)
  reg(onEvents, 'onEvents', events)
  reg(onProjects, 'onProjects', projects)
  reg(sendAddProject, 'sendAddProject', projects)
  reg(onPreferences, 'onPreferences', preferences)
  reg(savePreferences, 'savePreferences', preferences)
  reg(onEditors, 'onEditors', preferences)
  reg(onQuota, 'onQuota', quota)
}
