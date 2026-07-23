import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { ProjectsProvider } from './projects.js'
import { registryPreferencesStore, type PreferencesStore } from '../registry.js'
import { defaultQuotaSource, type QuotaSource } from './quota.js'
import { serveClientBundle } from './static.js'
import { BROWSER_PROXY_PREFIX, handleBrowserProxy } from './browser-proxy.js'
import { makeTelefuncMount } from './telefunc-serve.js'
import { requestPathname } from '../request-path.js'
import type { AddProjectResult, PreviewResult, PreviewStatus, StartRunKind, StartRunOptions, StartRunResult } from './types.js'
import type { EventsSource, PreviewHandlers, RemoteRuns } from './telefunc-serve.js'
import { handleRelayRequest, RELAY_PREFIX, type RelayHandlers } from './relay-endpoints.js'

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
  /**
   * The shared token that guards a non-loopback bind (#1051): with it set, every route (static
   * bundle, `/_telefunc`, `/browser`, `/_relay`) needs a valid `fw_daemon` cookie or a matching
   * `?token=`, else 401. Omit for a loopback bind, where the guard is a no-op and local UX is
   * byte-identical. A separate concern from the CSRF origin check in telefunc-serve.ts.
   */
  token?: string
  /**
   * The live-events source for a run this daemon is relaying from a connected device (#1067): a
   * stream for such a run, else undefined so `onEvents` tails the on-disk log. Only the daemon
   * wires one; the per-run dashboard and the relay leave it unset.
   */
  eventsSource?: EventsSource
  /**
   * The relayed-run lookup the read RPCs consult (#1067 slice 2); only the daemon wires it. A run-scoped
   * RPC uses it to forward a remote run's read/steer/handoff to the device that owns it.
   */
  remote?: RemoteRuns
  /**
   * Serve a relay-started run's events back to the daemon that relayed it here (#1067): the
   * `/_relay/*` endpoints (start + events, plus the slice-2 `rpc`). Only the daemon wires one, and all
   * are fronted by the same `token` guard above, so a device without the cookie cannot start or read a run.
   */
  relay?: {
    tailEvents: (runId: string, onEvent: (event: import('../events.js').FrameworkEvent) => void) => () => void
    /** Run one whitelisted run-scoped RPC against this daemon's own checkout (#1067 slice 2). */
    rpc?: (fn: string, args: unknown[]) => Promise<unknown>
  }
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
    ...(opts.eventsSource ? { eventsSource: opts.eventsSource } : {}),
    ...(opts.remote ? { remote: opts.remote } : {}),
    preferences: opts.preferences ?? registryPreferencesStore(),
    quota,
  })

  // The device-to-daemon relay endpoints (#1067): wired only when the daemon supplies both a start
  // and an events tail. Fronted by the same token guard as every other route below.
  const relayHandlers: RelayHandlers | undefined =
    opts.onStart && opts.relay
      ? { start: opts.onStart, tailEvents: opts.relay.tailEvents, ...(opts.relay.rpc ? { rpc: opts.relay.rpc } : {}) }
      : undefined

  const token = opts.token
  const server = createServer((req, res) => {
    const pathname = requestPathname(req)
    if (pathname === undefined) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
      return
    }
    // #1051: one guard fronting every route on a non-loopback bind; a no-op when no token is set.
    if (token !== undefined && !authorizeDaemonRequest(req, res, token)) return
    // The device relay (#1067): another daemon posts a run here and streams its events back. Behind
    // the guard above, so a device without the cookie is already 401'd; unwired hosts 404 it.
    if (pathname === RELAY_PREFIX || pathname.startsWith(`${RELAY_PREFIX}/`)) {
      void handleRelayRequest(req, res, pathname, relayHandlers)
      return
    }
    if (pathname === '/_telefunc' || pathname.startsWith('/_telefunc/')) {
      void telefuncMount(req, res)
      return
    }
    // The browser preview (#813) is proxied, not Telefunc'd: it is an endless MJPEG body and a
    // raw input POST, neither of which is an RPC.
    if (pathname.startsWith(`${BROWSER_PROXY_PREFIX}/`)) {
      void handleBrowserProxy(req, res)
        .then(handled => {
          if (!handled) void serveClientBundle(req, res, clientBundleDir)
        })
        // Whatever the proxy throws must not become an unhandled rejection that kills the
        // daemon (#938); tear the socket down rather than leave the request hanging.
        .catch(() => res.destroy())
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
  // Force-close keep-alive + streaming sockets (e.g. an open /_relay/events body, #1067) so close() resolves instead of waiting on them.
  server.closeAllConnections()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/** The cookie a bootstrapped browser carries on every same-origin request (#1051). */
const DAEMON_COOKIE = 'fw_daemon'

/**
 * The non-loopback bind guard (#1051): a request needs a valid `fw_daemon` cookie or a matching
 * `?token=`, else 401. A valid `?token=` sets the cookie and 302s to the clean path so the token
 * leaves the URL bar, history, and Referer after one hop; the cookie then rides RPC, the events
 * Channel, and the MJPEG `<img>` screencast alike (all same-origin), which a bearer header cannot
 * reach. Returns true to admit the request, false once it has answered (401 or the redirect).
 */
export function authorizeDaemonRequest(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  // Safe to re-parse: requestPathname already parsed this same url without throwing (#938).
  const url = new URL(req.url ?? '/', 'http://localhost')
  const queryToken = url.searchParams.get('token')
  if (queryToken !== null && tokensMatch(queryToken, token)) {
    url.searchParams.delete('token')
    const query = url.searchParams.toString()
    res.writeHead(302, {
      // Lax, not Strict: the #1052 device-hop is a cross-origin top-level nav, and a Strict cookie set on it is withheld from the redirect right after, so the clean path 401s. Lax still rides top-level GET navs; CSRF stays covered by the same-origin check on /_telefunc.
      'set-cookie': `${DAEMON_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
      location: url.pathname + (query ? `?${query}` : ''),
    })
    res.end()
    return false
  }
  const cookieToken = readCookie(req.headers.cookie, DAEMON_COOKIE)
  if (cookieToken !== undefined && tokensMatch(cookieToken, token)) return true
  res.writeHead(401, { 'content-type': 'text/plain' })
  res.end('unauthorized')
  return false
}

/** Constant-time token compare (#1051). The length check first, since `timingSafeEqual` throws on
 * unequal-length buffers and a length mismatch cannot be a match anyway. */
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** One cookie's value out of a `Cookie` header, or `undefined`. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}
