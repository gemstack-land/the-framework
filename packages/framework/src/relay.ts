import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from './events.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { serveClientBundle } from './dashboard/static.js'
import { makeTelefuncMount } from './dashboard/telefunc-serve.js'
import { emptyProjectsProvider } from './dashboard/projects.js'

/**
 * The hosted run relay (#230): the first slice toward shared team sessions. It
 * ingests a run's {@link FrameworkEvent} stream over HTTP and re-serves the same new
 * dashboard (#405) to N remote browsers, keyed by run id. So two people on different
 * machines open one run URL and both watch it live.
 *
 * It serves the prerendered dashboard SPA and streams events over Telefunc, exactly
 * like the daemon — except the run comes from the relay's own in-memory stream (fed by
 * publishers over HTTP), not a file. The dashboard opens in a read-only, single-run
 * "watch" mode (no Projects/Runs/Docs rails, no Stop/Start), and only the live event
 * stream is exposed: an empty projects provider (#426) makes the file/registry-backed
 * RPCs return nothing on this public host.
 *
 * Deliberately unauthenticated: anyone with a run's URL can watch it. Accounts, teams,
 * RBAC, and authorized steering layer on later (via vike-auth/-rbac). The relay only
 * projects the stream — it never runs an agent.
 *
 * Endpoints:
 * - `POST /r/:id/publish` — ingest one event (JSON object) or a batch (JSON array)
 * - `GET  /?run=:id`      — the dashboard SPA in read-only watch mode for that run
 * - `GET  /r/:id[/]`      — redirects to `/?run=:id` (the viewer URL)
 * - `POST /_telefunc`     — the dashboard's Telefunc surface (only `onEvents` is live)
 * - `GET  /assets/…`      — the SPA's static assets
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
  /**
   * The prerendered dashboard bundle to serve (the SPA `index.html` + `assets/**`).
   * Defaults to {@link resolveDashboardBundle}; pass a directory to override (tests).
   * When no bundle is found, the SPA routes 404 while publish/telefunc/healthz still work.
   */
  clientBundleDir?: string
}

/** A running relay. Ingest events programmatically or over HTTP; browsers watch by run id. */
export interface Relay {
  /** The base URL of the relay (e.g. `http://0.0.0.0:4488`). */
  readonly url: string
  /** The viewer URL for a run id (`<url>/?run=<id>`). */
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
}

const RUN_PATH = /^\/r\/([^/]+)(\/[^?]*)?/

/** Start the hosted run relay. See {@link Relay}. */
export async function startRelay(opts: RelayOptions = {}): Promise<Relay> {
  const host = opts.host ?? '0.0.0.0'
  const port = opts.port ?? 4488
  const maxBody = opts.maxBodyBytes ?? 256 * 1024
  const maxRuns = opts.maxRuns ?? 200
  const clientBundleDir = opts.clientBundleDir ?? (await resolveDashboardBundle())
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
      runs.get(oldest)!.stream.close() // closing drains every viewer's Channel follower
      runs.delete(oldest)
    }
    const r: Run = { stream: new EventStream<FrameworkEvent>() }
    runs.set(id, r)
    return r
  }

  // The dashboard's Telefunc surface, mounted like the daemon's — but `onEvents` streams
  // the relay's own in-memory run (create-on-access, so a viewer can connect before the
  // publisher), and an empty projects provider neutralizes every file/registry RPC on
  // this public host. No `startRun`, so a start is never enabled here.
  const telefunc = makeTelefuncMount({ projects: emptyProjectsProvider(), eventsSource: id => run(id).stream })
  const server = createServer((req, res) => handle(req, res, { run, maxBody, clientBundleDir, telefunc }))

  return new Promise<Relay>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      const address = server.address() as AddressInfo
      const url = `http://${host}:${address.port}`
      resolvePromise({
        url,
        viewerUrl: id => `${url}/?run=${encodeURIComponent(id)}`,
        ingest: (id, event) => run(id).stream.push(event),
        runIds: () => [...runs.keys()],
        close: () => closeRelay(server, runs),
      })
    })
  })
}

interface HandleCtx {
  run: (id: string) => Run
  maxBody: number
  clientBundleDir: string | undefined
  telefunc: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
}

function handle(req: IncomingMessage, res: ServerResponse, ctx: HandleCtx): void {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  // The dashboard's live event stream (and the rest of its RPC surface, neutralized).
  if (pathname === '/_telefunc' || pathname.startsWith('/_telefunc/')) {
    void ctx.telefunc(req, res)
    return
  }
  const m = RUN_PATH.exec(pathname)
  if (m) {
    const id = decodeURIComponent(m[1]!)
    const rest = m[2] ?? ''
    // Ingest is the one thing still under /r/:id/ — the publisher POSTs a run's events here.
    if (rest === '/publish') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' })
        res.end('method not allowed')
        return
      }
      ingestBody(req, res, ctx.run(id), ctx.maxBody)
      return
    }
    // Any viewer GET of a run moved to the SPA at `/?run=:id`; redirect old links there.
    res.writeHead(302, { location: `/?run=${encodeURIComponent(id)}` })
    res.end()
    return
  }
  // Everything else is the dashboard SPA (`/`, `/?run=:id`, `/assets/**`, SPA fallback).
  if (ctx.clientBundleDir) {
    void serveClientBundle(req, res, ctx.clientBundleDir)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('dashboard bundle not built')
}

/** Read a JSON body (one event or an array) and push each event into the run's stream. */
function ingestBody(req: IncomingMessage, res: ServerResponse, r: Run, maxBody: number): void {
  // Collect raw bytes and decode once at the end: a per-chunk `String(chunk)` corrupts a
  // multibyte UTF-8 codepoint split across two chunks, and the cap is in bytes, not the
  // UTF-16 code units a string length would count.
  const chunks: Buffer[] = []
  let bytes = 0
  let tooBig = false
  req.on('data', (chunk: Buffer) => {
    if (tooBig) return
    bytes += chunk.length
    if (bytes > maxBody) {
      tooBig = true
      res.writeHead(413, { 'content-type': 'text/plain' })
      res.end('payload too large')
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (tooBig) return
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
  for (const { stream } of runs.values()) stream.close() // closing drains each Channel follower
  runs.clear()
  return new Promise(resolvePromise => server.close(() => resolvePromise()))
}

/** A publisher that forwards a run's events to a relay. Best-effort and ordered. */
export interface RelayPublisher {
  /** The viewer URL to share (`<base>/?run=<id>`). */
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
  const origin = base.replace(/\/+$/, '')
  const root = `${origin}/r/${encodeURIComponent(runId)}`
  let chain: Promise<void> = Promise.resolve()
  return {
    // Share the SPA viewer URL; events still POST to the ingest route under /r/:id/.
    url: `${origin}/?run=${encodeURIComponent(runId)}`,
    publish(event) {
      chain = chain.then(async () => {
        try {
          // Timeout so a relay that accepts but never responds can't wedge flush()
          // (awaited on shutdown) and hang the whole CLI on exit.
          const res = await fetch(`${root}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(timeoutMs),
          })
          // fetch only throws on a transport failure, so a rejected event (413 over
          // the body cap, 400, or a URL that isn't a relay) would otherwise be silent.
          if (!res.ok) throw new Error(`relay answered ${res.status} ${res.statusText}`.trimEnd())
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
