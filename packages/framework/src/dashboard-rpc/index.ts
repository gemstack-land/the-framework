// The dashboard's Telefunc surface (#405), served in-process by the daemon. The
// implementations live here in @gemstack/framework so `sendStart` (added with the serve
// wiring) can reach the daemon's `startRun`; the framework-dashboard client imports
// these through thin re-export shims so the baked RPC keys stay `/server/*.telefunc.ts`.
export { onRuns, onRun, onDocs, onProjectLog } from './reads.telefunc.js'
export { sendStop, sendChoice, sendStart } from './control.telefunc.js'
export { onEvents } from './events.telefunc.js'
export { onProjects } from './projects.telefunc.js'
export { registerDashboardTelefunctions, DASHBOARD_TELEFUNC_KEYS } from './register.js'
