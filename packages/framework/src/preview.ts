import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * On-demand app preview (#475): serve a project's built result from the dashboard
 * without an agent run. This is the decoupled twin of the run's serve gate — where
 * that boots the app to *verify* it, this boots it to *show* it (a one-click Preview
 * button, useful for non-technical users too). It runs entirely in the daemon
 * process: the project's dev script when it has one, else a built-in static server
 * for a plain `index.html`. Kept a quick-win (#475): a URL + a Stop, not a full
 * in-dashboard preview view.
 */

/** A running preview: its URL, how it was served, and a teardown. */
export interface PreviewHandle {
  /** The reachable localhost URL. */
  url: string
  /** The npm script serving it (e.g. `dev`), or `static` for the built-in file server. */
  command: string
  /** Stop the preview and free its port. Idempotent. */
  stop(): Promise<void>
  /**
   * Resolves when the preview is no longer serving — on {@link stop}, or when the dev
   * server exits on its own (a crash, a build error, the user killing it). The daemon
   * watches this to evict a dead preview so the next open restarts it (#475).
   */
  exited: Promise<void>
}

/** Options for {@link startPreview}. */
export interface StartPreviewOptions {
  /** The project directory to serve. */
  cwd: string
  /** How long to wait for a dev script to print its localhost URL before giving up. Default 20s. */
  waitMs?: number
}

/** The npm scripts we try, best-first, when serving a project's dev preview. */
export const PREVIEW_SCRIPTS = ['dev', 'start', 'preview', 'serve'] as const

/** The first {@link PREVIEW_SCRIPTS} entry the project's `package.json` defines, else undefined. */
export async function detectDevScript(cwd: string): Promise<string | undefined> {
  let pkg: { scripts?: Record<string, unknown> }
  try {
    pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
  } catch {
    return undefined // no package.json, or it is unreadable/malformed
  }
  const scripts = pkg.scripts ?? {}
  return PREVIEW_SCRIPTS.find(name => typeof scripts[name] === 'string' && (scripts[name] as string).trim() !== '')
}

// Strip ANSI color codes (dev servers print their URL in color) before matching.
const ANSI = /\[[0-9;]*m/g
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"]*)?/i

/**
 * Parse the first browsable localhost URL a dev server prints (Vite, Next, CRA, and
 * friends all announce one), normalizing `0.0.0.0` to `localhost` and trimming any
 * trailing punctuation. Returns undefined when the output carries no such URL yet.
 */
export function parsePreviewUrl(output: string): string | undefined {
  const match = output.replace(ANSI, '').match(LOCAL_URL)
  if (!match) return undefined
  return match[0].replace(/^(https?:\/\/)0\.0\.0\.0/, '$1localhost').replace(/[.,;:)\]]+$/, '')
}

/**
 * Start a live preview of the project. Prefers its dev script (spawned as its own
 * process group so {@link PreviewHandle.stop} kills the whole tree), and reads the
 * localhost URL the server announces on stdout/stderr. With no dev script, falls back
 * to a built-in static server when the project has an `index.html`. Throws when there
 * is nothing to serve, or the dev script never announces a URL.
 */
export async function startPreview(opts: StartPreviewOptions): Promise<PreviewHandle> {
  const script = await detectDevScript(opts.cwd)
  if (script) return startDevServer(opts.cwd, script, opts.waitMs ?? 20_000)
  const hasIndex = await stat(join(opts.cwd, 'index.html')).then(s => s.isFile()).catch(() => false)
  if (hasIndex) return startStaticServer(opts.cwd)
  throw new Error('nothing to preview: the project has no dev script and no index.html')
}

/** Run the project's dev script and resolve once it announces a localhost URL. */
async function startDevServer(cwd: string, script: string, waitMs: number): Promise<PreviewHandle> {
  const command = `npm run ${script}`
  // Own process group (detached) so stop() can SIGTERM the whole tree, not just npm.
  const child = spawn('npm', ['run', script], { cwd, env: process.env, detached: true })
  try {
    const url = await new Promise<string>((resolvePromise, reject) => {
      let output = ''
      const timer = setTimeout(
        () => reject(new Error(`the "${script}" script did not print a localhost URL within ${Math.round(waitMs / 1000)}s`)),
        waitMs,
      )
      const settle = (fn: () => void): void => {
        clearTimeout(timer)
        child.stdout?.off('data', onData)
        child.stderr?.off('data', onData)
        child.off('exit', onExit)
        child.off('error', onError)
        fn()
      }
      const onData = (d: Buffer): void => {
        output += d.toString()
        const found = parsePreviewUrl(output)
        if (found) settle(() => resolvePromise(found))
      }
      const onExit = (): void => settle(() => reject(new Error(`the "${script}" script exited before printing a URL`)))
      const onError = (err: Error): void => settle(() => reject(err))
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('exit', onExit)
      child.once('error', onError)
    })
    // Resolves whether the child is killed by stop() or exits on its own (crash/build error).
    const exited = new Promise<void>(resolvePromise => child.once('exit', () => resolvePromise()))
    return { url, command, exited, stop: () => stopChild(child) }
  } catch (err) {
    await stopChild(child)
    throw err
  }
}

/** SIGTERM the child's process group, escalating to SIGKILL, and resolve once it exits. */
function stopChild(child: ChildProcess): Promise<void> {
  return new Promise(resolvePromise => {
    if (child.exitCode !== null || child.signalCode) return resolvePromise()
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolvePromise()
    }
    child.once('exit', finish)
    const kill = (sig: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        // group already gone
      }
    }
    kill('SIGTERM')
    setTimeout(() => {
      kill('SIGKILL')
      finish()
    }, 3000).unref()
  })
}

/** A built-in static file server for a project with a plain `index.html` and no dev script. */
async function startStaticServer(cwd: string): Promise<PreviewHandle> {
  const server = createServer((req, res) => void serveStaticFile(cwd, req.url ?? '/', res))
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const port = (server.address() as AddressInfo).port
  const exited = new Promise<void>(resolvePromise => server.once('close', () => resolvePromise()))
  return {
    url: `http://localhost:${port}`,
    command: 'static',
    exited,
    stop: () =>
      new Promise(resolvePromise => {
        // Destroy any lingering keep-alive sockets so close() cannot hang on an open tab.
        server.closeAllConnections?.()
        server.close(() => resolvePromise())
      }),
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** Serve one file from `root`, defaulting `/` to `index.html`, refusing path traversal. */
async function serveStaticFile(root: string, urlPath: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(urlPath.split('?')[0]!)).replace(/^(\.\.[/\\])+/, '')
  const target = join(root, rel === '/' || rel === '.' || rel === '' ? 'index.html' : rel)
  // Refuse anything that escaped the root after normalization.
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
    return
  }
  const info = await stat(target).catch(() => undefined)
  const file = info?.isDirectory() ? join(target, 'index.html') : target
  const fileInfo = info?.isDirectory() ? await stat(file).catch(() => undefined) : info
  if (!fileInfo?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}
