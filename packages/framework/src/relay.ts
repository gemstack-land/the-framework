import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from './events.js'
import { dashboardHtml } from './dashboard/page.js'
import { serveSSE } from './dashboard/sse.js'

/**
 * The hosted run relay (#230): the first slice toward shared team sessions. It
 * ingests a run's {@link FrameworkEvent} stream over HTTP and re-serves the exact
 * same dashboard (SSE + history replay) to N remote browsers, keyed by run id. So
 * two people on different machines open one run URL and both watch it live.
 *
 * Deliberately unauthenticated: anyone with a run's URL can watch it. Accounts,
 * teams, RBAC, and authorized steering layer on later (via vike-auth/-rbac). The
 * relay only projects the stream — it never runs an agent.
 *
 * Endpoints (per run id):
 * - `POST /r/:id/publish` — ingest one event (JSON object) or a batch (JSON array)
 * - `GET  /r/:id/`        — the dashboard page (read-only: no Stop button)
 * - `GET  /r/:id/events`  — the SSE stream (replays history, then follows live)
 * - `GET  /r/:id`         — redirects to `/r/:id/` so the page's relative paths resolve
 * - `GET  /healthz`       — liveness probe for the host
 */
export interface RelayOptions {
  /** Port to bind. Default `4488`; pass `0` for an ephemeral port. */
  port?: number
  /**
   * Host to bind. Default `0.0.0.0` — the relay exists to be reached from other
   * machines. Bind `127.0.0.1` to keep it local (e.g. tests).
   */
  host?: string
  /** Page title. Default `"The Framework"`. */
  title?: string
  /** Max bytes accepted per publish request body. Default 256 KiB. */
  maxBodyBytes?: number
  /**
   * Max concurrent runs kept in memory. The relay is unauthenticated, so any
   * request to `/r/<id>/…` would otherwise create a run that never frees — an
   * anonymous caller could exhaust memory. On overflow the least-recently-touched
   * run is evicted (its stream closed, its viewers dropped). Default 200.
   */
  maxRuns?: number
}

/** A running relay. Ingest events programmatically or over HTTP; browsers watch by run id. */
export interface Relay {
  /** The base URL of the relay (e.g. `http://0.0.0.0:4488`). */
  readonly url: string
  /** The viewer URL for a run id (`<url>/r/<id>/`). */
  viewerUrl(runId: string): string
  /** Push one event into a run's stream, creating the run on first use. */
  ingest(runId: string, event: FrameworkEvent): void
  /** The run ids seen so far. */
  runIds(): string[]
  /** Close every stream and stop the server. Idempotent. */
  close(): Promise<void>
}

interface Run {
  stream: EventStream<FrameworkEvent>
  clients: Set<ServerResponse>
}

const RUN_PATH = /^\/r\/([^/]+)(\/[^?]*)?/

/** Start the hosted run relay. See {@link Relay}. */
export function startRelay(opts: RelayOptions = {}): Promise<Relay> {
  const host = opts.host ?? '0.0.0.0'
  const port = opts.port ?? 4488
  const title = opts.title ?? 'The Framework'
  const maxBody = opts.maxBodyBytes ?? 256 * 1024
  const maxRuns = opts.maxRuns ?? 200
  // Insertion-ordered as an LRU: touching a run re-inserts it at the end, so the
  // first entry is always the least-recently-used and the eviction victim.
  const runs = new Map<string, Run>()

  const run = (id: string): Run => {
    const existing = runs.get(id)
    if (existing) {
      runs.delete(id)
      runs.set(id, existing) // touch: move to most-recently-used
      return existing
    }
    // Bound memory: evict the least-recently-used run before creating a new one.
    while (runs.size >= maxRuns) {
      const oldest = runs.keys().next().value
      if (oldest === undefined) break
      const victim = runs.get(oldest)!
      victim.stream.close()
      for (const res of victim.clients) res.end()
      runs.delete(oldest)
    }
    const r: Run = { stream: new EventStream<FrameworkEvent>(), clients: new Set() }
    runs.set(id, r)
    return r
  }

  const server = createServer((req, res) => handle(req, res, { runs, run, title, maxBody }))

  return new Promise<Relay>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      const url = `http://${host}:${address.port}`
      resolvePromise({
        url,
        viewerUrl: id => `${url}/r/${encodeURIComponent(id)}/`,
        ingest: (id, event) => run(id).stream.push(event),
        runIds: () => [...runs.keys()],
        close: () => closeRelay(server, runs),
      })
    })
  })
}

interface HandleCtx {
  runs: Map<string, Run>
  run: (id: string) => Run
  title: string
  maxBody: number
}

function handle(req: IncomingMessage, res: ServerResponse, ctx: HandleCtx): void {
  const url = req.url ?? '/'
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  const m = RUN_PATH.exec(url)
  if (!m) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const id = decodeURIComponent(m[1]!)
  const rest = m[2] ?? ''

  // No trailing slash: redirect so the page's relative `events`/`stop` resolve under /r/:id/.
  if (rest === '') {
    res.writeHead(302, { location: `/r/${encodeURIComponent(id)}/` })
    res.end()
    return
  }
  if (rest === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(dashboardHtml(ctx.title, false)) // read-only: steering is out of scope for the keystone
    return
  }
  if (rest === '/events') {
    const r = ctx.run(id)
    serveSSE(req, res, r.stream, r.clients)
    return
  }
  if (rest === '/publish') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    ingestBody(req, res, ctx.run(id), ctx.maxBody)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
}

/** Read a JSON body (one event or an array) and push each event into the run's stream. */
function ingestBody(req: IncomingMessage, res: ServerResponse, r: Run, maxBody: number): void {
  let body = ''
  let tooBig = false
  req.on('data', (chunk: Buffer) => {
    if (tooBig) return
    body += chunk
    if (body.length > maxBody) {
      tooBig = true
      res.writeHead(413, { 'content-type': 'text/plain' })
      res.end('payload too large')
      req.destroy()
    }
  })
  req.on('end', () => {
    if (tooBig) return
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('invalid json')
      return
    }
    const events = (Array.isArray(parsed) ? parsed : [parsed]) as FrameworkEvent[]
    for (const event of events) r.stream.push(event)
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(`{"ok":true,"received":${events.length}}`)
  })
}

function closeRelay(server: Server, runs: Map<string, Run>): Promise<void> {
  for (const { stream, clients } of runs.values()) {
    stream.close()
    for (const res of clients) res.end()
    clients.clear()
  }
  runs.clear()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/** A publisher that forwards a run's events to a relay. Best-effort and ordered. */
export interface RelayPublisher {
  /** The viewer URL to share (`<base>/r/<id>/`). */
  readonly url: string
  /** Queue one event to POST to the relay (serialized, so the relay replays in order). */
  publish(event: FrameworkEvent): void
  /** Resolve once every queued POST has been sent (or failed), for a clean shutdown. */
  flush(): Promise<void>
}

/**
 * Forward a live run's {@link FrameworkEvent}s to a {@link startRelay} relay so
 * remote browsers can watch it. POSTs are serialized (chained) so the relay's
 * replay order matches the run, and best-effort: a failed POST is reported via
 * `onError` but never interrupts the run.
 */
export function relayPublisher(
  base: string,
  runId: string,
  onError?: (err: unknown) => void,
  timeoutMs = 10_000,
): RelayPublisher {
  const root = `${base.replace(/\/+$/, '')}/r/${encodeURIComponent(runId)}`
  let chain: Promise<void> = Promise.resolve()
  return {
    url: `${root}/`,
    publish(event) {
      chain = chain.then(async () => {
        try {
          // Timeout so a relay that accepts but never responds can't wedge flush()
          // (awaited on shutdown) and hang the whole CLI on exit.
          await fetch(`${root}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (err) {
          onError?.(err)
        }
      })
    },
    flush() {
      return chain
    },
  }
}
