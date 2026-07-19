import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * The run's browser, streamed to a human (#802, part of #609).
 *
 * The `await-browser` gate (#796) parks a run and asks someone to deal with a login wall or a
 * captcha. The browser it is parked on is headless and owned by the run (#793), so there is
 * nothing for that person to click. This serves it: the latest screencast frame as MJPEG, and
 * clicks/keys back in over POST.
 *
 * Why the run hosts this rather than the dashboard driving Chrome directly: Chrome refuses
 * DevTools socket connections carrying an `Origin` header unless launched with
 * `--remote-allow-origins`, and opening that up would let any page the user happens to visit
 * drive the agent's browser. The debug port stays unreachable from the web; this bridge is the
 * only way in.
 *
 * Why MJPEG rather than a WebSocket: an `<img>` renders `multipart/x-mixed-replace` natively
 * and input is a plain POST, so the dashboard needs no client library and the framework needs
 * no new dependency — Node's global WebSocket is enough to talk to Chrome.
 */
export interface BrowserStream {
  /** Where the dashboard points an `<img>` (`/stream`) and posts input (`/input`). */
  url: string
  /** Stop streaming and close the server. Safe to call twice. */
  close(): Promise<void>
}

/** One page Chrome is showing, from `/json/list`. */
export interface CdpPageTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

/**
 * The page a human should be looking at: the agent's current one.
 *
 * Chrome lists targets most-recently-used first, so the first `page` is the one the agent is
 * working in. Picking by position is what keeps the pane from going blind when the agent opens
 * a tab — the failure the spike hit. Ignores targets with no socket (a crashed or detached
 * tab) rather than returning something unusable.
 */
export function pickActivePage(targets: readonly CdpPageTarget[]): CdpPageTarget | undefined {
  return targets.find(t => t.type === 'page' && !!t.webSocketDebuggerUrl)
}

/** The input a human can send back through the pane. Coordinates are in page pixels. */
export type BrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'key'; text: string }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'navigate'; url: string }

/** A CDP call the bridge makes on the human's behalf. */
export interface CdpCall {
  method: string
  params: Record<string, unknown>
}

/**
 * The CDP calls one input maps to, or `[]` for anything unrecognized — a malformed POST must
 * never reach Chrome. A click is press + release (Chrome ignores a lone `mousePressed`), and
 * text goes through `insertText` so it types the character rather than a key code, which is
 * what makes non-ASCII and password managers behave.
 */
export function inputToCdp(input: BrowserInput): CdpCall[] {
  switch (input?.type) {
    case 'click': {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return []
      const base = { x: input.x, y: input.y, button: 'left', clickCount: 1 }
      return [
        { method: 'Input.dispatchMouseEvent', params: { ...base, type: 'mousePressed' } },
        { method: 'Input.dispatchMouseEvent', params: { ...base, type: 'mouseReleased' } },
      ]
    }
    case 'key': {
      if (typeof input.text !== 'string' || input.text === '') return []
      return [{ method: 'Input.insertText', params: { text: input.text } }]
    }
    case 'scroll': {
      if (!Number.isFinite(input.deltaY)) return []
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseWheel', x: input.x ?? 0, y: input.y ?? 0, deltaX: 0, deltaY: input.deltaY },
        },
      ]
    }
    case 'navigate': {
      if (typeof input.url !== 'string' || !/^https?:\/\//i.test(input.url)) return []
      return [{ method: 'Page.navigate', params: { url: input.url } }]
    }
    default:
      return []
  }
}

/** The MJPEG part header for one frame. */
export function framePart(boundary: string, jpeg: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
    jpeg,
    Buffer.from('\r\n'),
  ])
}

const BOUNDARY = 'frame'

/** What the bridge needs from a CDP connection, so a test can stand in for Chrome. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: 'Page.screencastFrame', handler: (params: { data: string; sessionId: number }) => void): void
  close(): void
}

/** How the bridge reaches a page. Injectable: the real one speaks WebSocket to Chrome. */
export type CdpConnect = (webSocketDebuggerUrl: string) => Promise<CdpSession>

/**
 * Start the bridge. Returns undefined when Chrome has no page to stream — the caller carries
 * on without a pane rather than failing the run.
 *
 * The stream is bound to loopback explicitly: the frames can contain whatever the human is
 * typing, including a password, so this must not be reachable from the network. For the same
 * reason no frame is ever written to disk or into the run's event log.
 */
export async function startBrowserStream(opts: {
  browserUrl: string
  connect: CdpConnect
  listTargets?: (browserUrl: string) => Promise<CdpPageTarget[]>
  /** How often to check whether the agent moved to another tab. 0 disables following. */
  followIntervalMs?: number
}): Promise<BrowserStream | undefined> {
  const listTargets = opts.listTargets ?? defaultListTargets
  const targets = await listTargets(opts.browserUrl).catch(() => [])
  const page = pickActivePage(targets)
  if (!page?.webSocketDebuggerUrl) return undefined

  let latest: Buffer | undefined
  const viewers = new Set<import('node:http').ServerResponse>()

  /** Attach the screencast to one page. Frames land in `latest` and go straight to viewers. */
  const attach = async (target: CdpPageTarget): Promise<CdpSession> => {
    const session = await opts.connect(target.webSocketDebuggerUrl!)
    session.on('Page.screencastFrame', ({ data, sessionId }) => {
      latest = Buffer.from(data, 'base64')
      for (const res of viewers) res.write(framePart(BOUNDARY, latest))
      void session.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720 })
    return session
  }

  let current = page
  let session = await attach(page)

  /**
   * Follow the agent when it opens or switches tabs. Without this the pane shows whichever
   * page happened to be first while the agent works somewhere else — the exact failure the
   * #609 spike reproduced. Cheap: one `/json/list` on an interval, re-attach only on change.
   */
  const followMs = opts.followIntervalMs ?? 2000
  const follow = followMs
    ? setInterval(() => {
        void (async () => {
          const next = pickActivePage(await listTargets(opts.browserUrl).catch(() => []))
          if (!next?.webSocketDebuggerUrl || next.id === current.id) return
          const previous = session
          try {
            session = await attach(next)
            current = next
            await previous.send('Page.stopScreencast').catch(() => {})
            previous.close()
          } catch {
            // Keep streaming the page we already have rather than dropping the pane.
          }
        })()
      }, followMs)
    : undefined
  follow?.unref?.()

  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/stream')) {
      res.writeHead(200, {
        'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        'cache-control': 'no-store',
        connection: 'close',
      })
      // Node holds the headers back until the first write, so a pane opened before any frame
      // exists would hang waiting for a response rather than showing an empty stream.
      res.flushHeaders()
      // Chrome only emits a frame when the page changes, so a pane opened on a still page
      // would sit blank. Send the last one we have immediately.
      if (latest) res.write(framePart(BOUNDARY, latest))
      viewers.add(res)
      req.on('close', () => viewers.delete(res))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/input')) {
      let body = ''
      req.on('data', chunk => {
        body += chunk
        if (body.length > 8192) req.destroy() // an input payload is tiny; anything else is not input
      })
      req.on('end', () => {
        let calls: CdpCall[] = []
        try {
          calls = inputToCdp(JSON.parse(body) as BrowserInput)
        } catch {
          calls = []
        }
        for (const call of calls) void session.send(call.method, call.params).catch(() => {})
        res.writeHead(calls.length ? 204 : 400).end()
      })
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  let closed = false
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closed) return
      closed = true
      if (follow) clearInterval(follow)
      for (const res of viewers) res.end()
      viewers.clear()
      await session.send('Page.stopScreencast').catch(() => {})
      session.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

/**
 * Talk CDP to Chrome over its debugger socket. Node's global WebSocket is enough, which is
 * what keeps this dependency-free.
 */
export const connectCdp: CdpConnect = async (webSocketDebuggerUrl: string) => {
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`could not open ${webSocketDebuggerUrl}`)), { once: true })
  })

  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const frameHandlers: ((p: { data: string; sessionId: number }) => void)[] = []

  ws.addEventListener('message', ev => {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message ?? 'CDP error')) : p.resolve(msg.result)
      return
    }
    if (msg.method === 'Page.screencastFrame') {
      for (const handler of frameHandlers) handler(msg.params as { data: string; sessionId: number })
    }
  })

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        try {
          ws.send(JSON.stringify({ id, method, params }))
        } catch (err) {
          pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }),
    on: (_event, handler) => void frameHandlers.push(handler),
    close: () => ws.close(),
  }
}

/** The real target list: Chrome's own `/json/list`. */
async function defaultListTargets(browserUrl: string): Promise<CdpPageTarget[]> {
  const res = await fetch(`${browserUrl}/json/list`)
  if (!res.ok) return []
  const body = (await res.json()) as CdpPageTarget[]
  return Array.isArray(body) ? body : []
}
