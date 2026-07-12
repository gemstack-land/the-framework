import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventStream } from '@gemstack/ai-autopilot'
import type { ChoiceBy, FrameworkEvent } from '../events.js'
import type { EcoOptions } from '../system-prompt.js'
import { listRuns, loadRunEvents } from '../store/index.js'
import { readLogs } from '../logs.js'
import { readDocs } from './docs.js'
import { defaultProjectsProvider, type ProjectsProvider } from './projects.js'
import { dashboardHtml } from './page.js'
import { serveSSE } from './sse.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  /** Port to bind. Default `4200`; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind. Default `127.0.0.1` (localhost only). */
  host?: string
  /** Page title. Default `"The Framework"`. */
  title?: string
  /**
   * Called when the browser hits the Stop button (`POST /stop`). Wire this to
   * abort the run (e.g. an `AbortController.abort()`). The optional `projectId` is
   * the `?project=<id>` the page is viewing (#393), so the daemon steers the right
   * project; absent means the default project. Omit to disable stopping; the page
   * hides the button when the server reports no stop handler.
   */
  onStop?: (projectId?: string) => void
  /**
   * Called when the browser posts an interactive-choice pick (#304): `POST /choice`
   * with a JSON `{ id, pick, by }` body. Wire this to resolve the run's pending
   * choice (e.g. settle the promise a `requestChoice` handler returned). The optional
   * `projectId` routes the pick to the viewed project (#393). Omit to disable
   * interactive choices; the page still renders them but the route reports no handler
   * (404).
   */
  onChoice?: (id: string, pick: string | string[], by: ChoiceBy, projectId?: string) => void
  /**
   * The workspace whose `.the-framework/runs/` archive backs the run-history sidebar
   * (#303): `GET /api/runs` lists it, `GET /api/runs/<id>` replays one run. Omit
   * to disable history (the endpoints report an empty list).
   */
  cwd?: string
  /**
   * Called when the browser posts a new-run prompt (#345): `POST /api/start`
   * with a JSON `{ prompt, kind?, options? }` body. Wire this to spawn the run (the
   * daemon does); return `busy: true` to refuse because a run is already active
   * (409). Omit to disable starting; the page hides the prompt panel. The Global
   * options (#314) ride along in `options`; the optional `projectId` targets the
   * viewed project (#393), spawning the run with that project's `--cwd`.
   */
  onStart?: (
    prompt: string,
    kind: StartRunKind,
    options: StartRunOptions,
    projectId?: string,
  ) => StartRunResult | Promise<StartRunResult>
  /**
   * The multi-project registry read side (#392): `GET /api/projects` lists it, and
   * `?project=<id>` on the read endpoints resolves to that project's path. Omit to
   * use the real registry (the daemon does); tests pass a fake. The `cwd` above
   * stays the default project when no `?project=` is given (single-project
   * back-compat) and the target the live stream + run start/stop still follow (#393).
   */
  projects?: ProjectsProvider
  /**
   * Install + register projects (#396): `POST /api/projects` with a JSON
   * `{ path, directory? }` body. Wire this to install the repo (or every git repo
   * under a directory) and add it to the registry (the daemon does). Omit to
   * disable adding; the page hides the "Add project(s)" control.
   */
  onAddProject?: (path: string, directory: boolean) => Promise<AddProjectResult> | AddProjectResult
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

/** A running localhost dashboard. Push {@link FrameworkEvent}s; it renders them live. */
export interface Dashboard {
  /** The URL to open. */
  readonly url: string
  /** The event stream backing the page (own it here, guardrail #2). */
  readonly stream: EventStream<FrameworkEvent>
  /** Push one event to every connected browser (and the replay buffer). */
  push(event: FrameworkEvent): void
  /** Close connections and stop the server. Idempotent. */
  close(): Promise<void>
}

/**
 * Start the localhost dashboard: a tiny `node:http` server that serves one HTML
 * page and streams {@link FrameworkEvent}s to it over Server-Sent Events. The
 * page foregrounds what the wrapped agent's own chat cannot: the chosen stack
 * and its PROS/CONS rationale, the loop status + checklist blockers, the
 * decisions ledger, and a link to the live agent session (#165).
 *
 * We own the stream, so the same events feed the terminal and the browser, and a
 * late-connecting browser replays history via {@link EventStream}.
 */
export function startDashboard(opts: DashboardOptions = {}): Promise<Dashboard> {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4200
  const title = opts.title ?? 'The Framework'
  const onStop = opts.onStop
  const onChoice = opts.onChoice
  const onStart = opts.onStart
  const cwd = opts.cwd
  const projects = opts.projects ?? defaultProjectsProvider()
  const onAddProject = opts.onAddProject
  const stream = new EventStream<FrameworkEvent>()
  const clients = new Set<ServerResponse>()

  const server = createServer((req, res) => handle(req, res, stream, clients, title, onStop, onChoice, onStart, cwd, projects, onAddProject))

  return new Promise<Dashboard>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      const url = `http://${host}:${address.port}`
      resolvePromise({
        url,
        stream,
        push: event => stream.push(event),
        close: () => closeServer(server, clients, stream),
      })
    })
  })
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  stream: EventStream<FrameworkEvent>,
  clients: Set<ServerResponse>,
  title: string,
  onStop: ((projectId?: string) => void) | undefined,
  onChoice: ((id: string, pick: string | string[], by: ChoiceBy, projectId?: string) => void) | undefined,
  onStart:
    | ((prompt: string, kind: StartRunKind, options: StartRunOptions, projectId?: string) => StartRunResult | Promise<StartRunResult>)
    | undefined,
  cwd: string | undefined,
  projects: ProjectsProvider,
  onAddProject: ((path: string, directory: boolean) => Promise<AddProjectResult> | AddProjectResult) | undefined,
): void {
  const url = req.url ?? '/'
  // Parse once so a `?project=<id>` query never bleeds into the pathname match
  // (and a run id in `/api/runs/<id>` is read from the pathname, not the query).
  const { pathname, searchParams } = new URL(url, 'http://localhost')
  const projectId = searchParams.get('project')
  if (pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(dashboardHtml(title, Boolean(onStop), Boolean(onChoice), Boolean(onStart), Boolean(onAddProject)))
    return
  }
  if (pathname === '/events') {
    serveSSE(req, res, stream, clients)
    return
  }
  // The registered projects (#392): the Projects sidebar lists these (GET), then
  // reads one via `?project=<id>` on the endpoints below. A POST installs + adds a
  // project (#396) through the wired handler, guarded like the other POST routes.
  if (pathname === '/api/projects') {
    if (req.method === 'POST') {
      if (!isSameOriginRequest(req)) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('cross-origin request forbidden')
        return
      }
      if (!onAddProject) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('adding projects not enabled')
        return
      }
      readJsonBody(req, body => {
        const path = typeof body['path'] === 'string' ? body['path'].trim() : ''
        const directory = body['directory'] === true
        if (!path) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end('{"error":"a project path is required"}')
          return
        }
        void Promise.resolve(onAddProject(path, directory))
          .then(result => {
            res.writeHead(result.ok ? 202 : 400, { 'content-type': 'application/json' })
            res.end(JSON.stringify(result))
          })
          .catch(err => {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
          })
      })
      return
    }
    void serveProjects(res, projects)
    return
  }
  // Run history (#303). The list feeds the second sidebar; a single run's log is
  // replayed client-side into the same projection the live stream drives. A
  // `?project=<id>` reads that project's archive; absent, the daemon's own cwd.
  if (pathname === '/api/runs') {
    void resolveCwd(projects, projectId, cwd).then(target => serveRunList(res, target))
    return
  }
  if (pathname.startsWith('/api/runs/')) {
    const runId = decodeURIComponent(pathname.slice('/api/runs/'.length))
    void resolveCwd(projects, projectId, cwd).then(target => serveRun(res, target, runId))
    return
  }
  // Document sidebar (#319): the PLAN.md / TODO.md the agent writes at the
  // workspace root, so the human can read the plan + backlog beside the run.
  if (pathname === '/api/docs') {
    void resolveCwd(projects, projectId, cwd).then(target => serveDocs(res, target))
    return
  }
  // Project log (#314): the committed `.the-framework/LOGS.md` history of every
  // loop/prompt/build run in a project (#378/#379), newest-first.
  if (pathname === '/api/logs') {
    void resolveCwd(projects, projectId, cwd).then(target => serveLogs(res, target))
    return
  }
  if (pathname === '/stop') {
    // The Stop button. Idempotent: a stop after the run has ended just aborts an
    // already-aborted signal (a no-op). 405 for a non-POST so a stray GET can't
    // interrupt a run. 404 when no handler was wired (stopping disabled).
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return
    }
    if (!onStop) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('stopping not enabled')
      return
    }
    onStop(projectId ?? undefined)
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  if (pathname === '/choice') {
    // An interactive-choice pick (#304). Same guards as /stop: 405 for a non-POST
    // so a stray GET can't resolve a choice, 404 when no handler is wired.
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return
    }
    if (!onChoice) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('choices not enabled')
      return
    }
    readJsonBody(req, body => {
      const id = typeof body['id'] === 'string' ? body['id'] : ''
      const raw = body['pick']
      // A single-select posts one id (string); a multi-select (#332) posts the
      // selected subset (array), which may legitimately be empty (nothing checked).
      const pick: string | string[] = typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === 'string')
          : ''
      const by: ChoiceBy = body['by'] === 'autopilot' ? 'autopilot' : body['by'] === 'auto' ? 'auto' : 'user'
      if (id && (Array.isArray(pick) || pick)) onChoice(id, pick, by, projectId ?? undefined)
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    return
  }
  if (pathname === '/api/start') {
    // Start a new run from the dashboard (#345). Same guards as /stop: POST-only
    // so a stray GET can never spawn a run, 404 when no handler is wired (the
    // per-run dashboard and the relay never start runs). 409 = a run is active.
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return
    }
    if (!onStart) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('starting not enabled')
      return
    }
    readJsonBody(req, body => {
      const prompt = typeof body['prompt'] === 'string' ? body['prompt'].trim() : ''
      const kind: StartRunKind =
        body['kind'] === 'research' ? 'research' : body['kind'] === 'prompt' ? 'prompt' : 'build'
      // A research run's "what" defaults server-side (`this PR`); a build or a
      // verbatim prompt run has nothing to run without text.
      if (!prompt && kind !== 'research') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end('{"error":"a non-empty prompt is required"}')
        return
      }
      // onStart may resolve the target project's path from the registry (#393), so
      // it can be async; await it before answering. A thrown handler is a 500.
      void Promise.resolve(onStart(prompt, kind, parseStartOptions(body['options']), projectId ?? undefined))
        .then(result => {
          if (!result.ok) {
            res.writeHead(result.busy ? 409 : 500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: result.error }))
            return
          }
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        })
        .catch(err => {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        })
    })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
}

/**
 * CSRF guard for the state-changing POST routes. A browser attaches an `Origin`
 * header to every cross-site request, so we reject any POST whose Origin is not
 * this same server (or a loopback host) — otherwise a page on `evil.com` could
 * `fetch()` the localhost dashboard and spawn/steer a run. An absent Origin means
 * a non-browser caller (curl, the test suite) with no ambient session to abuse,
 * so it passes.
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
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
 * Sanitize the posted Global options (#314) into a {@link StartRunOptions}. Only
 * known boolean fields survive, so a malformed or hostile body can never smuggle
 * anything into the run flags. An absent/non-object value yields all-off.
 */
export function parseStartOptions(raw: unknown): StartRunOptions {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const ecoSrc = src['eco'] && typeof src['eco'] === 'object' ? (src['eco'] as Record<string, unknown>) : {}
  const eco: EcoOptions = {
    ...(ecoSrc['autoPlanning'] === true ? { autoPlanning: true } : {}),
    ...(ecoSrc['autoResearch'] === true ? { autoResearch: true } : {}),
    ...(ecoSrc['autoMaintenance'] === true ? { autoMaintenance: true } : {}),
  }
  return {
    ...(src['autopilot'] === true ? { autopilot: true } : {}),
    ...(src['technical'] === true ? { technical: true } : {}),
    ...(src['vanilla'] === true ? { vanilla: true } : {}),
    ...(Object.keys(eco).length ? { eco } : {}),
  }
}

/** Read a small JSON request body, tolerant of malformed input (yields `{}`). */
function readJsonBody(req: IncomingMessage, cb: (body: Record<string, unknown>) => void): void {
  let data = ''
  req.on('data', (chunk: Buffer) => {
    data += chunk
    if (data.length > 64_000) req.destroy() // cap the body; a pick is tiny
  })
  req.on('end', () => {
    let body: unknown
    try {
      body = JSON.parse(data || '{}')
    } catch {
      body = {}
    }
    cb(body && typeof body === 'object' ? (body as Record<string, unknown>) : {})
  })
  req.on('error', () => cb({}))
}

/** `GET /api/projects` — every registered project, summarized (or `[]`). */
async function serveProjects(res: ServerResponse, projects: ProjectsProvider): Promise<void> {
  const list = await projects.list().catch(() => [])
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ projects: list }))
}

/**
 * The workspace a read endpoint should serve: the project named by `?project=<id>`
 * when present (its registry path, or `undefined` when the id is unknown, which
 * the readers surface as empty), else the server's default `cwd`.
 */
async function resolveCwd(
  projects: ProjectsProvider,
  projectId: string | null,
  fallback: string | undefined,
): Promise<string | undefined> {
  if (!projectId) return fallback
  return projects.resolvePath(projectId)
}

/** `GET /api/runs` — the project's archived runs, most-recent first (or `[]`). */
async function serveRunList(res: ServerResponse, cwd: string | undefined): Promise<void> {
  const runs = cwd ? await listRuns(cwd).catch(() => []) : []
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ runs }))
}

/** `GET /api/runs/<id>` — one archived run's meta + event log for replay. */
async function serveRun(res: ServerResponse, cwd: string | undefined, id: string): Promise<void> {
  const events = cwd ? await loadRunEvents(cwd, id).catch(() => undefined) : undefined
  if (!events) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"run not found"}')
    return
  }
  const meta = cwd ? (await listRuns(cwd).catch(() => [])).find(r => r.id === id) : undefined
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ id, meta, events }))
}

/** `GET /api/docs` — the surfaced workspace documents (PLAN.md, TODO.md), or `[]`. */
async function serveDocs(res: ServerResponse, cwd: string | undefined): Promise<void> {
  const docs = cwd ? await readDocs(cwd).catch(() => []) : []
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ docs }))
}

/** `GET /api/logs` — the workspace's committed `.the-framework/LOGS.md` entries, newest-first, or `[]`. */
async function serveLogs(res: ServerResponse, cwd: string | undefined): Promise<void> {
  const logs = cwd ? await readLogs(cwd).catch(() => []) : []
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ logs }))
}

function closeServer(
  server: Server,
  clients: Set<ServerResponse>,
  stream: EventStream<FrameworkEvent>,
): Promise<void> {
  stream.close()
  for (const res of clients) res.end()
  clients.clear()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}
