import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from 'telefunc'
import { Telefunc } from 'telefunc/node'
import { registerDashboardTelefunctions } from '../dashboard-rpc/register.js'
import type { ProjectsProvider } from './projects.js'
import type { FrameworkEvent } from '../events.js'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from './quota.js'
import type { AddProjectResult, PreviewResult, PreviewStatus, StartRunKind, StartRunOptions, StartRunResult } from './types.js'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startRun` closure. */
export type StartRunHandler = (
  prompt: string,
  kind: StartRunKind,
  options: StartRunOptions,
  projectId?: string,
) => StartRunResult | Promise<StartRunResult>

/** Wired by the daemon so `sendAddProject` can install + register a repo (#433). */
export type AddProjectHandler = (path: string, directory: boolean) => AddProjectResult | Promise<AddProjectResult>

/** Wired by the daemon so the Preview RPCs can serve/stop/report a project's app (#475). */
export interface PreviewHandlers {
  start: (projectId?: string) => PreviewResult | Promise<PreviewResult>
  stop: (projectId?: string) => void | Promise<void>
  status: (projectId?: string) => PreviewStatus | Promise<PreviewStatus>
}

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
  addProject?: AddProjectHandler
  /** The Preview handler set (#475); the daemon wires it, other hosts leave it unset. */
  preview?: PreviewHandlers
  projects?: ProjectsProvider
  eventsSource?: EventsSource
  /** The user-preferences store (#410). The daemon/foreground wire the real registry file;
   * a public host (the relay) leaves it unset so `onPreferences`/`savePreferences` are inert. */
  preferences?: PreferencesStore
  /** The quota source behind the usage panel (#533). The daemon wires a live poller;
   * a public host (the relay) leaves it unset, so `onQuota` reports it has no reading. */
  quota?: QuotaSource
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
 * CSRF guard for the state-changing Telefunc calls. A browser attaches an `Origin`
 * header to every cross-site request, so we reject any POST whose Origin is not this
 * same server (or a loopback host) — otherwise a page on `evil.com` could `fetch()` the
 * localhost dashboard and spawn/steer a run. An absent Origin means a non-browser caller
 * (curl, the test suite) with no ambient session to abuse, so it passes. Lives here beside
 * the mount, its only caller.
 */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false // malformed Origin: treat as cross-origin
  }
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.')
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
  addProject?: AddProjectHandler,
  preferences?: PreferencesStore,
  preview?: PreviewHandlers,
  quota?: QuotaSource,
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
      ...(addProject ? { addProject } : {}),
      ...(preview ? { preview } : {}),
      ...(projects ? { projects } : {}),
      ...(eventsSource ? { eventsSource } : {}),
      ...(preferences ? { preferences } : {}),
      ...(quota ? { quota } : {}),
    }
    // Never let a telefunc failure become an unhandled rejection that kills the daemon:
    // telefunc 0.2.22 throws on a bare `GET /_telefunc` (it passes the request as a body,
    // which `new Request()` rejects for GET), and a browser tab hits that on reconnect.
    try {
      return await tf.serve({ req, res, context: context as never })
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('bad telefunc request')
      } else {
        res.end()
      }
      return true
    }
  }
}
