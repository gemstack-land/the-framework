import { readFile, stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { contentTypeFor } from './content-type.js'

// Serve the prerendered dashboard bundle (#405). The new dashboard is a Vike `ssr:false`
// SPA prerendered to a static `index.html` + `assets/**`, so the daemon serves it as
// plain files with an SPA fallback (any non-asset path yields `index.html`, which boots
// the client router) — no Vike runtime in the daemon. Assets are copied into the
// framework package at build time (see scripts/bundle-dashboard.mjs).

/** Whether a real, readable file exists at `path`. */
async function isFile(path: string): Promise<boolean> {
  return stat(path).then(s => s.isFile()).catch(() => false)
}

/** Decode a percent-encoded path; a malformed escape names no file, so it decodes to nothing. */
function tryDecode(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return ''
  }
}

/**
 * Serve `dir`'s static bundle for this request: the requested file when it exists,
 * otherwise `index.html` (the SPA fallback, so client routes and unknown paths still
 * boot the app). Path-traversal is guarded — a request that escapes `dir` falls back to
 * `index.html` rather than reading outside the bundle.
 */
export async function serveClientBundle(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  // A malformed escape (`/%zz`) must not throw: this runs void-dispatched, so an
  // exception here would be an unhandled rejection that takes the daemon down (#938).
  const rel = tryDecode(pathname).replace(/^\/+/, '')
  const root = normalize(dir)
  const candidate = normalize(join(root, rel))
  const within = candidate === root || candidate.startsWith(root + sep)

  const target = within && rel && (await isFile(candidate)) ? candidate : join(root, 'index.html')
  const body = await readFile(target).catch(() => undefined)
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('dashboard bundle not built')
    return
  }
  const type = contentTypeFor(target)
  // Fingerprinted assets are immutable; index.html must always revalidate.
  const cacheControl = target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl })
  res.end(body)
}
