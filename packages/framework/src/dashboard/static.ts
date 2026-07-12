import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Serve the prerendered dashboard bundle (#405). The new dashboard is a Vike `ssr:false`
// SPA prerendered to a static `index.html` + `assets/**`, so the daemon serves it as
// plain files with an SPA fallback (any non-asset path yields `index.html`, which boots
// the client router) — no Vike runtime in the daemon. Assets are copied into the
// framework package at build time (see scripts/bundle-dashboard.mjs).

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** Whether a real, readable file exists at `path`. */
async function isFile(path: string): Promise<boolean> {
  return stat(path).then(s => s.isFile()).catch(() => false)
}

/**
 * Serve `dir`'s static bundle for this request: the requested file when it exists,
 * otherwise `index.html` (the SPA fallback, so client routes and unknown paths still
 * boot the app). Path-traversal is guarded — a request that escapes `dir` falls back to
 * `index.html` rather than reading outside the bundle.
 */
export async function serveClientBundle(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
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
  const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream'
  // Fingerprinted assets are immutable; index.html must always revalidate.
  const cacheControl = target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl })
  res.end(body)
}
