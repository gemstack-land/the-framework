import { __decorateTelefunction } from 'telefunc'
import * as reads from './reads.telefunc.js'
import * as control from './control.telefunc.js'
import * as events from './events.telefunc.js'
import * as projects from './projects.telefunc.js'
import * as preferences from './preferences.telefunc.js'
import * as quota from './quota.telefunc.js'

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

// Every function export of these modules is a telefunction; each is registered under its own
// export name, so the name can never drift from the identifier and an exported-but-unregistered
// function (the #866 400-and-nothing-else failure) is impossible by construction.
const TELEFUNC_MODULES: Record<keyof typeof DASHBOARD_TELEFUNC_KEYS, Record<string, unknown>> = {
  reads,
  control,
  events,
  projects,
  preferences,
  quota,
}

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
  for (const group of Object.keys(TELEFUNC_MODULES) as Array<keyof typeof DASHBOARD_TELEFUNC_KEYS>) {
    const key = DASHBOARD_TELEFUNC_KEYS[group]
    for (const [name, fn] of Object.entries(TELEFUNC_MODULES[group])) {
      if (typeof fn !== 'function') continue
      registeredNames.add(name)
      __decorateTelefunction(fn as never, name, key, appRootDir)
    }
  }
}
