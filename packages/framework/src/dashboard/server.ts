import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ProjectsProvider } from './projects.js'
import { registryPreferencesStore, type PreferencesStore } from '../registry.js'
import { defaultQuotaSource, type QuotaSource } from './quota.js'
import { serveClientBundle } from './static.js'
import { BROWSER_PROXY_PREFIX, handleBrowserProxy } from './browser-proxy.js'
import { makeTelefuncMount } from './telefunc-serve.js'
import type { AddProjectResult, PreviewResult, PreviewStatus, StartRunKind, StartRunOptions, StartRunResult } from './types.js'
import type { PreviewHandlers } from './telefunc-serve.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  /** Port to bind. Default `4200`; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind. Default `127.0.0.1` (localhost only). */
  host?: string
  /**
   * Called when the browser starts a run (#345): the `sendStart` telefunction reaches
   * this through the request context. Wire it to spawn the run (the daemon does); return
   * `busy: true` to refuse because a run is already active. Omit to disable starting (the
   * per-run dashboard and the relay never start runs); `sendStart` then reports so.
   */
  onStart?: (
    prompt: string,
    kind: StartRunKind,
    options: StartRunOptions,
    projectId?: string,
  ) => StartRunResult | Promise<StartRunResult>
  /**
   * The multi-project registry provider (#392/#427): the `onProjects` / read / steer
   * telefunctions resolve project ids through this. Omit to use the real registry (the
   * daemon does); the per-run dashboard passes a single-project provider, the relay an
   * empty one.
   */
  projects?: ProjectsProvider
  /**
   * Called when the browser adds a project (#396): the `sendAddProject` telefunction
   * reaches this through the request context. Wire it to install the repo (or every git
   * repo under a directory) and register it (the daemon does). Omit to disable adding.
   */
  onAddProject?: (path: string, directory: boolean) => Promise<AddProjectResult> | AddProjectResult
  /**
   * The Preview handler set (#475): serve a project's built result on demand, list its servable
   * apps, stop it, and report whether one is running. Omit to disable Preview (the per-run
   * dashboard and the relay never serve one).
   *
   * One field of the shared {@link PreviewHandlers} type rather than four separate callbacks: the
   * four were re-declared here without their `runId` parameter, so the per-session Preview (#797)
   * reached the daemon only because this file happened to pass each function straight through by
   * reference. One wrapper added for a log line or a guard would have dropped `runId` silently,
   * with nothing for the compiler or a test to catch.
   */
  preview?: PreviewHandlers
  /**
   * The user-preferences store (#410): the `onPreferences` / `savePreferences` telefunctions
   * read/write it through the request context. Defaults to the real registry file (the daemon
   * and per-run foreground dashboard both want it); the public relay serves its own mount and
   * never wires one, so preferences stay inert there.
   */
  preferences?: PreferencesStore
  /**
   * Where the usage panel reads the quota from (#533). Defaults to the daemon's
   * own poller; the relay passes nothing and mounts no panel.
   */
  quota?: QuotaSource
  /**
   * Serve the new dashboard bundle (#405) from this directory — the prerendered Vike SPA
   * (`index.html` + `assets/**`). The daemon also mounts the dashboard's Telefunc surface
   * at `/_telefunc` (RPCs + the live-event Channel). Omit only for a broken install with
   * no built bundle, where the server reports the bundle is missing.
   */
  clientBundleDir?: string
}

/** A running localhost dashboard: the prerendered SPA + its Telefunc mount. */
export interface Dashboard {
  /** The URL to open. */
  readonly url: string
  /** Stop the server. Idempotent. */
  close(): Promise<void>
}

/**
 * Start the localhost dashboard: a tiny `node:http` server that serves the prerendered
 * Vike SPA (#405) and mounts its Telefunc surface at `/_telefunc` — the RPCs and the
 * live-event Channel. The dashboard reads the run's `.the-framework/events.jsonl` over the
 * Channel and steers it through `control.jsonl`, so there is no in-process event stream
 * here; the server is a static-bundle + RPC host. Telefunc runs in-process, so `sendStart`
 * / `sendAddProject` call the daemon's own closures via {@link DashboardOptions.onStart} /
 * {@link DashboardOptions.onAddProject}.
 */
export function startDashboard(opts: DashboardOptions = {}): Promise<Dashboard> {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4200
  const clientBundleDir = opts.clientBundleDir

  // A broken install ships no built bundle (the published package always does), so serve
  // 503 for everything rather than stand up a half-wired mount. Returning here lets the
  // main path below treat the bundle, mount, and quota as present with no re-checks.
  if (!clientBundleDir) {
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('the dashboard bundle is not installed')
    })
    return listenDashboard(server, host, port, () => closeServer(server))
  }

  // The usage panel polls for the dashboard's whole life, not just during a run:
  // it has to show where the account stands while nothing is running (#533).
  const quota = opts.quota ?? defaultQuotaSource()
  // `projects` is passed raw (may be undefined) so the mount falls back to the global
  // registry, byte-identical to the daemon default; the per-run dashboard passes a
  // single-project provider, the relay an empty one.
  const telefuncMount = makeTelefuncMount({
    ...(opts.onStart ? { startRun: opts.onStart } : {}),
    ...(opts.projects ? { projects: opts.projects } : {}),
    ...(opts.onAddProject ? { addProject: opts.onAddProject } : {}),
    ...(opts.preview ? { preview: opts.preview } : {}),
    preferences: opts.preferences ?? registryPreferencesStore(),
    quota,
  })

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === '/_telefunc' || pathname.startsWith('/_telefunc/')) {
      void telefuncMount(req, res)
      return
    }
    // The browser preview (#813) is proxied, not Telefunc'd: it is an endless MJPEG body and a
    // raw input POST, neither of which is an RPC.
    if (pathname.startsWith(`${BROWSER_PROXY_PREFIX}/`)) {
      void handleBrowserProxy(req, res).then(handled => {
        if (!handled) void serveClientBundle(req, res, clientBundleDir)
      })
      return
    }
    void serveClientBundle(req, res, clientBundleDir)
  })
  return listenDashboard(server, host, port, async () => {
    // Stop polling with the server: the poller outlives every run by design,
    // so nothing else would ever end it.
    quota.stop()
    await closeServer(server)
  })
}

/** Bind the server and resolve a {@link Dashboard} handle; rejects if the port is already taken. */
function listenDashboard(server: Server, host: string, port: number, close: () => Promise<void>): Promise<Dashboard> {
  return new Promise<Dashboard>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      resolvePromise({ url: `http://${host}:${address.port}`, close })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}
