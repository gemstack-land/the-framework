import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { readLiveMetas } from '../store/index.js'
import { defaultProjectsProvider } from './projects.js'

/**
 * The dashboard's route to a run's browser preview (#813).
 *
 * The bridge itself lives in the run (#802) on a port the OS picks per run. The dashboard is a
 * different origin, on the daemon's port, so it cannot post to that bridge directly: a JSON POST
 * would need a CORS preflight, and answering it would mean letting browser origins reach the
 * bridge — giving up exactly the containment #802 paid for by keeping Chrome's debug port
 * unreachable from the web.
 *
 * So the daemon proxies. The pane talks same-origin to the daemon, the daemon talks to loopback,
 * and the run's port is never named by the client: it comes from the run's own meta. A caller
 * cannot point this at an arbitrary port, which is what keeps it from being an open relay into
 * anything else listening on loopback.
 */

/** Where a proxied request is headed, once the URL has been understood. */
export interface BrowserRoute {
  projectId: string
  runId: string
  /** `stream` renders in an `<img>`; `input` carries a click or a key back. */
  leg: 'stream' | 'input'
}

/** The prefix the dashboard client posts to. */
export const BROWSER_PROXY_PREFIX = '/browser'

/**
 * Parse `/browser/<projectId>/<runId>/stream|input`, or undefined for anything else — an
 * unrecognized shape must fall through to the bundle rather than be guessed at. Ids are taken
 * verbatim and only ever used to look a run up, never as a path.
 */
export function parseBrowserRoute(url: string | undefined): BrowserRoute | undefined {
  if (!url) return undefined
  // Parse and decode defensively: a malformed target or escape (`/browser/p/%zz/stream`) names
  // no run, and a throw here would escape the void-dispatched proxy handler as an unhandled
  // rejection that kills the daemon (#938). Unparseable falls through to the bundle like any
  // other unrecognized shape.
  try {
    const { pathname } = new URL(url, 'http://localhost')
    if (!pathname.startsWith(`${BROWSER_PROXY_PREFIX}/`)) return undefined
    const parts = pathname.slice(BROWSER_PROXY_PREFIX.length + 1).split('/')
    if (parts.length !== 3) return undefined
    const [projectId, runId, leg] = parts
    if (!projectId || !runId) return undefined
    if (leg !== 'stream' && leg !== 'input') return undefined
    return { projectId, runId: decodeURIComponent(runId), leg }
  } catch {
    return undefined
  }
}

/** How the proxy finds the run's bridge. Injectable so a test needs no registry and no run. */
export type BrowserPortLookup = (projectId: string, runId: string) => Promise<number | undefined>

/**
 * The real lookup: the port the run recorded on its own meta. A run with no browser, a finished
 * run, or an unknown id all read as undefined, which the caller turns into a 404.
 */
export const defaultBrowserPortLookup: BrowserPortLookup = async (projectId, runId) => {
  const cwd = await defaultProjectsProvider().resolvePath(projectId)
  if (!cwd) return undefined
  const live = await readLiveMetas(cwd).catch(() => [])
  const run = live.find(meta => meta.id === runId)
  // Only a live run: the bridge is torn down with the run, so a port off a finished one would
  // reach whatever the OS handed that number next.
  return run?.status === 'running' ? run.browserStreamPort : undefined
}

/**
 * Proxy one request to the run's bridge. Returns false when the URL is not a browser route, so
 * the dashboard server can carry on to the client bundle.
 *
 * Streams both ways rather than buffering: `/stream` is an endless `multipart/x-mixed-replace`
 * body, so anything that waits for it to finish never answers.
 */
export async function handleBrowserProxy(
  req: IncomingMessage,
  res: ServerResponse,
  lookup: BrowserPortLookup = defaultBrowserPortLookup,
): Promise<boolean> {
  const route = parseBrowserRoute(req.url)
  if (!route) return false

  const port = await lookup(route.projectId, route.runId).catch(() => undefined)
  if (!port) {
    // The pane polls this while a run is starting, and a run may never have a browser at all,
    // so a miss is ordinary rather than an error worth logging.
    res.writeHead(404, { 'content-type': 'text/plain' }).end('no browser preview for this run')
    return true
  }

  const upstream = request(
    {
      host: '127.0.0.1',
      port,
      path: route.leg === 'stream' ? '/stream' : '/input',
      method: route.leg === 'stream' ? 'GET' : 'POST',
      headers: route.leg === 'input' ? { 'content-type': 'application/json' } : {},
    },
    proxied => {
      res.writeHead(proxied.statusCode ?? 502, {
        ...proxied.headers,
        // The frames are a live view of whatever the human is typing. Nothing caches this.
        'cache-control': 'no-store',
      })
      proxied.pipe(res)
    },
  )

  // The run can die mid-stream, which lands here rather than as a response.
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end()
  })
  // Stop pulling frames the moment the pane goes away, or the run keeps serving a dead viewer.
  res.on('close', () => upstream.destroy())

  if (route.leg === 'input') req.pipe(upstream)
  else upstream.end()
  return true
}
