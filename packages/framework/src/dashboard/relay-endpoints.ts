import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FrameworkEvent } from '../events.js'
import type { StartRunKind, StartRunOptions, StartRunResult } from './types.js'

/**
 * The device-side of the remote-run relay (#1067): the two endpoints a daemon exposes so another
 * daemon (holding this device's token) can run a session here and watch it. They live under
 * `/_relay`, behind the #1051 token guard in {@link startDashboard}. The guard admits a matching
 * `fw_daemon` cookie without the browser-only `?token=` 302, so a daemon-to-daemon call passes with
 * a cookie and a token-less caller is already 401'd before it reaches here.
 *
 * - `POST /_relay/start`  starts an ordinary local run and returns its {@link StartRunResult}. It
 *   runs in this device's own home checkout (slice 1); which project it targets is a later slice.
 * - `GET  /_relay/events?run=<id>` streams that run's events as newline-delimited JSON until it
 *   ends or the caller disconnects.
 */
export const RELAY_PREFIX = '/_relay'

/** What the daemon wires behind the relay endpoints: its own start closure and an events tail. */
export interface RelayHandlers {
  start: (prompt: string, kind: StartRunKind, options: StartRunOptions, projectId?: string) => StartRunResult | Promise<StartRunResult>
  tailEvents: (runId: string, onEvent: (event: FrameworkEvent) => void) => () => void
}

/** The body `POST /_relay/start` accepts: exactly what a local Start needs, minus any project id. */
interface RelayStartBody {
  prompt?: unknown
  kind?: unknown
  options?: unknown
}

const MAX_START_BODY = 256 * 1024

/** Route a `/_relay/*` request. A host that wired no relay handlers 404s every relay route. */
export async function handleRelayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handlers: RelayHandlers | undefined,
): Promise<void> {
  if (!handlers) return end(res, 404, 'relay not enabled')
  if (pathname === `${RELAY_PREFIX}/start`) return handleStart(req, res, handlers)
  if (pathname === `${RELAY_PREFIX}/events`) return handleEvents(req, res, handlers)
  end(res, 404, 'not found')
}

/** `POST /_relay/start`: read the run request, start it locally, and answer with the result JSON. */
async function handleStart(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: RelayStartBody
  try {
    body = (await readJsonBody(req, MAX_START_BODY)) as RelayStartBody
  } catch {
    return end(res, 400, 'invalid request body')
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const kind: StartRunKind = body.kind === 'research' || body.kind === 'prompt' ? body.kind : 'build'
  const options = (body.options && typeof body.options === 'object' ? body.options : {}) as StartRunOptions
  // Never relay onward from a relayed run: strip any nested target before starting it here.
  const { remote: _drop, ...local } = options
  let result: StartRunResult
  try {
    result = await handlers.start(prompt, kind, local, undefined)
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result))
}

/** `GET /_relay/events?run=<id>`: stream the run's events as newline-delimited JSON. */
function handleEvents(req: IncomingMessage, res: ServerResponse, handlers: RelayHandlers): void {
  if (req.method !== 'GET') return end(res, 405, 'method not allowed', { allow: 'GET' })
  const runId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('run')
  if (!runId) return end(res, 400, 'missing run id')
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' })
  const stop = handlers.tailEvents(runId, event => {
    // A dropped write (the caller went away mid-line) must not throw out of the tail callback.
    try {
      res.write(`${JSON.stringify(event)}\n`)
    } catch {
      // the socket is gone; the close handler below tears the tail down
    }
  })
  const close = (): void => stop()
  res.on('close', close)
  req.on('close', close)
}

/** Read a capped JSON request body, rejecting on overflow or malformed JSON. */
function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        rejectPromise(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        rejectPromise(err instanceof Error ? err : new Error('invalid json'))
      }
    })
    req.on('error', rejectPromise)
  })
}

/** Answer a relay request with a plain-text status. */
function end(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain', ...headers })
  res.end(message)
}
