import { __decorateTelefunction } from 'telefunc'
import { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onTickets, onRetainedWorktrees, onRunWorktree, onRunHandoff, onSystemPromptUser } from './reads.telefunc.js'
import { sendStop, sendChoice, sendMessage, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp, sendRemoveWorktree, sendDeleteSession, sendPushBranch, sendOpenPullRequest, sendQueueTicket } from './control.telefunc.js'
import { onEvents } from './events.telefunc.js'
import { onProjects, sendAddProject } from './projects.telefunc.js'
import { onPreferences, savePreferences, onProjectPreferences, saveProjectPreferences, onEditors, onNotifyChannels } from './preferences.telefunc.js'
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
 * What {@link registerDashboardTelefunctions} actually registered, so a test can hold this
 * list against the telefunc modules' own exports. A telefunction that is exported, re-exported
 * by the dashboard's shim, and simply never registered here fails at runtime with a 400 and
 * nothing else: that is how per-project preferences shipped broken (#866).
 */
const registeredNames = new Set<string>()

/** The registered telefunction names. Empty until `registerDashboardTelefunctions` runs. */
export function registeredTelefunctionNames(): ReadonlySet<string> {
  return registeredNames
}

/**
 * Register the dashboard telefunctions under the client-baked keys (idempotent). The
 * `appRootDir` is cosmetic here — it is not part of the match key and shields are off
 * on the mount (see dashboard/telefunc-serve.ts).
 */
export function registerDashboardTelefunctions(appRootDir: string = process.cwd()): void {
  if (registered) return
  registered = true
  const reg = (fn: (...args: never[]) => unknown, name: string, key: string): void => {
    registeredNames.add(name)
    __decorateTelefunction(fn as never, name, key, appRootDir)
  }
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
  reg(onSystemPromptUser, 'onSystemPromptUser', reads)
  reg(onProjectFiles, 'onProjectFiles', reads)
  reg(onProjectFileStatus, 'onProjectFileStatus', reads)
  reg(onFileDiff, 'onFileDiff', reads)
  reg(onRunChanges, 'onRunChanges', reads)
  reg(onFileContent, 'onFileContent', reads)
  reg(onTickets, 'onTickets', reads)
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
  reg(sendDeleteSession, 'sendDeleteSession', control)
  reg(sendPushBranch, 'sendPushBranch', control)
  reg(sendOpenPullRequest, 'sendOpenPullRequest', control)
  reg(sendQueueTicket, 'sendQueueTicket', control)
  reg(onEvents, 'onEvents', events)
  reg(onProjects, 'onProjects', projects)
  reg(sendAddProject, 'sendAddProject', projects)
  reg(onPreferences, 'onPreferences', preferences)
  reg(savePreferences, 'savePreferences', preferences)
  reg(onProjectPreferences, 'onProjectPreferences', preferences)
  reg(saveProjectPreferences, 'saveProjectPreferences', preferences)
  reg(onEditors, 'onEditors', preferences)
  reg(onNotifyChannels, 'onNotifyChannels', preferences)
  reg(onQuota, 'onQuota', quota)
}
