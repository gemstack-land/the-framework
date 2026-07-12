import { __decorateTelefunction } from 'telefunc'
import { onRuns, onRun, onDocs, onProjectLog } from './reads.telefunc.js'
import { sendStop, sendChoice } from './control.telefunc.js'
import { onEvents } from './events.telefunc.js'
import { onProjects } from './projects.telefunc.js'

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
  const { reads, control, events, projects } = DASHBOARD_TELEFUNC_KEYS
  reg(onRuns, 'onRuns', reads)
  reg(onRun, 'onRun', reads)
  reg(onDocs, 'onDocs', reads)
  reg(onProjectLog, 'onProjectLog', reads)
  reg(sendStop, 'sendStop', control)
  reg(sendChoice, 'sendChoice', control)
  reg(onEvents, 'onEvents', events)
  reg(onProjects, 'onProjects', projects)
}
