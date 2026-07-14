import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EcoOptions } from '../system-prompt.js'
import type { ProjectsProvider } from './projects.js'
import { registryPreferencesStore, type PreferencesStore } from '../registry.js'
import { serveClientBundle } from './static.js'
import { makeTelefuncMount } from './telefunc-serve.js'

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
   * The user-preferences store (#410): the `onPreferences` / `savePreferences` telefunctions
   * read/write it through the request context. Defaults to the real registry file (the daemon
   * and per-run foreground dashboard both want it); the public relay serves its own mount and
   * never wires one, so preferences stay inert there.
   */
  preferences?: PreferencesStore
  /**
   * Serve the new dashboard bundle (#405) from this directory — the prerendered Vike SPA
   * (`index.html` + `assets/**`). The daemon also mounts the dashboard's Telefunc surface
   * at `/_telefunc` (RPCs + the live-event Channel). Omit only for a broken install with
   * no built bundle, where the server reports the bundle is missing.
   */
  clientBundleDir?: string
}

/** The outcome of an {@link DashboardOptions.onAddProject} attempt (#396). */
export type AddProjectResult =
  | { ok: true; added: number; alreadyActivated: number }
  | { ok: false; error: string }

/**
 * The dashboard's Global options (#314), posted alongside a Start. Each maps to a
 * run flag: Autopilot + Technical to modes, Vanilla to removing the built-in
 * system prompt, and Eco to the fine-grained #326 section drops. Absent fields
 * default off, i.e. today's behavior.
 */
export interface StartRunOptions {
  /** Auto-accept mode; also steers the #326 maintenance stance. */
  autopilot?: boolean
  /** Technical mode: expose technical detail (preset-scoped). */
  technical?: boolean
  /** Remove the built-in #326 system prompt entirely (raw Claude Code). */
  vanilla?: boolean
  /** Fine-grained #326 section drops to save tokens. */
  eco?: EcoOptions
  /** In-context directories (#439): each becomes a `--context <dir>` flag on the spawned run. */
  context?: string[]
  /** Bootstrap mode (#297/#448): a new project from an empty dir; maps to `--bootstrap`. */
  bootstrap?: boolean
  /** Post-merge quality suite (#326): on setReadyForMerge(), fire maintainability/readability/security-audit; maps to `--post-merge`. */
  postMerge?: boolean
  /** Give the agent a real browser via chrome-devtools-mcp during the run (#452); maps to `--browser`. */
  browser?: boolean
}

/**
 * What a dashboard Start spawns (#345/#331/#353): `build` is the normal framework
 * run; `prompt` runs the posted text verbatim through the direct path — what the
 * page sends after a preset prefilled (and the user possibly edited) the textarea;
 * `research` renders the [Research] preset around the posted "what" server-side
 * (empty allowed, defaults to `this PR`) and remains for API callers.
 */
export type StartRunKind = 'build' | 'research' | 'prompt'

/** The outcome of an {@link DashboardOptions.onStart} attempt (#345). */
export type StartRunResult =
  | { ok: true }
  | { ok: false; busy?: boolean; error: string }

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
  // `projects` is passed raw (may be undefined) so the mount falls back to the global
  // registry, byte-identical to the daemon default; the per-run dashboard passes a
  // single-project provider, the relay an empty one.
  const telefuncMount = clientBundleDir
    ? makeTelefuncMount(opts.onStart, opts.projects, undefined, opts.onAddProject, opts.preferences ?? registryPreferencesStore())
    : undefined

  const server = createServer((req, res) => {
    if (!clientBundleDir) {
      // A broken install with no built bundle (the published package ships it).
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('the dashboard bundle is not installed')
      return
    }
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === '/_telefunc' || pathname.startsWith('/_telefunc/')) {
      void telefuncMount!(req, res)
      return
    }
    void serveClientBundle(req, res, clientBundleDir)
  })

  return new Promise<Dashboard>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      const url = `http://${host}:${address.port}`
      resolvePromise({ url, close: () => closeServer(server) })
    })
  })
}

/**
 * CSRF guard for the state-changing Telefunc calls. A browser attaches an `Origin`
 * header to every cross-site request, so we reject any POST whose Origin is not this
 * same server (or a loopback host) — otherwise a page on `evil.com` could `fetch()` the
 * localhost dashboard and spawn/steer a run. An absent Origin means a non-browser caller
 * (curl, the test suite) with no ambient session to abuse, so it passes.
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

function closeServer(server: Server): Promise<void> {
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}
