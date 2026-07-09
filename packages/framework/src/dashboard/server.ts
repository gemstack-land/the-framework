import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from '../events.js'
import { listRuns, loadRunEvents } from '../store/index.js'
import { dashboardHtml } from './page.js'
import { serveSSE } from './sse.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  /** Port to bind. Default `4477`; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind. Default `127.0.0.1` (localhost only). */
  host?: string
  /** Page title. Default `"The Framework"`. */
  title?: string
  /**
   * Called when the browser hits the Stop button (`POST /stop`). Wire this to
   * abort the run (e.g. an `AbortController.abort()`). Omit to disable stopping;
   * the page hides the button when the server reports no stop handler.
   */
  onStop?: () => void
  /**
   * The workspace whose `.framework/runs/` archive backs the run-history sidebar
   * (#303): `GET /api/runs` lists it, `GET /api/runs/<id>` replays one run. Omit
   * to disable history (the endpoints report an empty list).
   */
  cwd?: string
}

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
  const port = opts.port ?? 4477
  const title = opts.title ?? 'The Framework'
  const onStop = opts.onStop
  const cwd = opts.cwd
  const stream = new EventStream<FrameworkEvent>()
  const clients = new Set<ServerResponse>()

  const server = createServer((req, res) => handle(req, res, stream, clients, title, onStop, cwd))

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
  onStop: (() => void) | undefined,
  cwd: string | undefined,
): void {
  const url = req.url ?? '/'
  if (url === '/' || url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(dashboardHtml(title, Boolean(onStop)))
    return
  }
  if (url === '/events') {
    serveSSE(req, res, stream, clients)
    return
  }
  // Run history (#303). The list feeds the second sidebar; a single run's log is
  // replayed client-side into the same projection the live stream drives.
  if (url === '/api/runs') {
    void serveRunList(res, cwd)
    return
  }
  if (url.startsWith('/api/runs/')) {
    void serveRun(res, cwd, decodeURIComponent(url.slice('/api/runs/'.length)))
    return
  }
  if (url === '/stop') {
    // The Stop button. Idempotent: a stop after the run has ended just aborts an
    // already-aborted signal (a no-op). 405 for a non-POST so a stray GET can't
    // interrupt a run. 404 when no handler was wired (stopping disabled).
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    if (!onStop) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('stopping not enabled')
      return
    }
    onStop()
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
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
