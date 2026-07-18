// The dashboard's Telefunc surface (#405), served in-process by the daemon. The
// implementations live here in @gemstack/framework so `sendStart` (added with the serve
// wiring) can reach the daemon's `startRun`; the framework-dashboard client imports
// these through thin re-export shims so the baked RPC keys stay `/server/*.telefunc.ts`.
export { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus } from './reads.telefunc.js'
export { sendStop, sendChoice, sendMessage, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp } from './control.telefunc.js'
export { onEvents } from './events.telefunc.js'
export { onProjects, sendAddProject } from './projects.telefunc.js'
export { onPreferences, savePreferences, onEditors, type SavePreferencesResult } from './preferences.telefunc.js'
export { type EditorInfo } from '../dashboard/open-in-app.js'
export { onQuota } from './quota.telefunc.js'
export { registerDashboardTelefunctions, DASHBOARD_TELEFUNC_KEYS } from './register.js'
