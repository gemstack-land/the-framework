import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from 'telefunc'
import { Telefunc } from 'telefunc/node'
import { registerDashboardTelefunctions } from '../dashboard-rpc/register.js'
import type { ProjectsProvider } from './projects.js'
import type { FrameworkEvent } from '../events.js'
import { isSameOriginRequest, type StartRunKind, type StartRunOptions, type StartRunResult } from './server.js'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startRun` closure. */
export type StartRunHandler = (
  prompt: string,
  kind: StartRunKind,
  options: StartRunOptions,
  projectId?: string,
) => StartRunResult | Promise<StartRunResult>

/** Resolve a project id to its live event stream (#426): the relay feeds `onEvents` from
 * its own in-memory stream rather than a file on disk. */
export type EventsSource = (projectId: string) => AsyncIterable<FrameworkEvent> | undefined

/**
 * The Telefunc request context the mount provides. `sendStart` reads `startRun` from it;
 * every project-keyed RPC reads `projects` (#427) — the daemon leaves it unset to use the
 * global registry, the per-run foreground dashboard passes a single-project provider. The
 * relay passes `eventsSource` (#426) so `onEvents` streams its in-memory run instead of a
 * file, plus an empty `projects` so the file/registry RPCs return nothing on a public host.
 */
export interface DashboardContext {
  startRun?: StartRunHandler
  projects?: ProjectsProvider
  eventsSource?: EventsSource
}

let instance: Telefunc | undefined

function setup(): Telefunc {
  if (instance) return instance
  // No Vite build runs over these functions, so there are no generated shields; the
  // mount is localhost-only and same-origin guarded, and every write funnels through
  // appendControl / the busy-guarded startRun. Disable shield generation and the
  // naming convention (our names are `onX`/`sendX`, not telefunc's query/mutation hint).
  ;(config as { shield?: unknown }).shield = { dev: false, prod: false }
  ;(config as { disableNamingConvention?: boolean }).disableNamingConvention = true
  registerDashboardTelefunctions()
  instance = new Telefunc()
  return instance
}

/**
 * Mount the dashboard's Telefunc surface (#405) on the daemon's `node:http` server: one
 * `serve()` handles both the RPCs and the Channel SSE stream at `/_telefunc`. Telefunc
 * runs in the daemon process, so a `sendStart` telefunction can call the daemon's own
 * `startRun` via the request context. Cross-origin POSTs are rejected (CSRF: a page on
 * evil.com must not steer or start a run). Returns whether the request was Telefunc's.
 */
export function makeTelefuncMount(
  startRun?: StartRunHandler,
  projects?: ProjectsProvider,
  eventsSource?: EventsSource,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return true
    }
    const tf = setup()
    const context: DashboardContext = {
      ...(startRun ? { startRun } : {}),
      ...(projects ? { projects } : {}),
      ...(eventsSource ? { eventsSource } : {}),
    }
    return tf.serve({ req, res, context: context as never })
  }
}
