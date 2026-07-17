import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, normalize, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { contentTypeFor } from './dashboard/content-type.js'

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
  /**
   * Which app to serve in a multi-package repo (#651), from {@link detectServeTargets}. Absent
   * serves the root package (the single-package default), preserving the original behavior.
   */
  target?: ServeTarget
  /** How long to wait for a dev script to print its localhost URL before giving up. Default 20s. */
  waitMs?: number
}

/** The npm scripts we try, best-first, when serving a project's dev preview. */
export const PREVIEW_SCRIPTS = ['dev', 'start', 'preview', 'serve'] as const

/** The first {@link PREVIEW_SCRIPTS} entry a `package.json`'s `scripts` defines, else undefined. */
function pickScript(scripts: Record<string, unknown> | undefined): string | undefined {
  const s = scripts ?? {}
  return PREVIEW_SCRIPTS.find(name => typeof s[name] === 'string' && (s[name] as string).trim() !== '')
}

/** The first {@link PREVIEW_SCRIPTS} entry the project's `package.json` defines, else undefined. */
export async function detectDevScript(cwd: string): Promise<string | undefined> {
  return pickScript((await readPkg(cwd))?.scripts)
}

/**
 * One servable app in a repo (#651): a package that defines a dev/serve script. Plain repos
 * have exactly one (the root); a monorepo has one per workspace package that can serve, and
 * the dashboard offers a picker over them.
 */
export interface ServeTarget {
  /** Stable id = the dir relative to the repo root, or `.` for the root package itself. */
  id: string
  /** Human label: the package.json `name`, else the directory basename (`.` → `root`). */
  label: string
  /** The dir to run the script in, relative to the repo root (`''` = the root). */
  dir: string
  /** The npm script that serves it (a {@link PREVIEW_SCRIPTS} entry). */
  script: string
}

/** How many workspace packages we scan / offer, so a pathological monorepo can't hang or flood the picker. */
const MAX_SERVE_TARGETS = 50

/**
 * Enumerate the repo's servable apps (#651), best-first: the root package (when it has a serve
 * script) followed by each workspace package that has one, in path order. A plain single-package
 * repo yields at most one target (the root); a monorepo yields one per servable workspace so the
 * Serve button can offer a pick. Workspaces come from `pnpm-workspace.yaml` or the package.json
 * `workspaces` field; unreadable/absent config just yields the root (or nothing).
 */
export async function detectServeTargets(cwd: string): Promise<ServeTarget[]> {
  const targets: ServeTarget[] = []
  const seen = new Set<string>()
  const add = async (dir: string): Promise<void> => {
    const abs = dir === '' ? cwd : join(cwd, dir)
    if (seen.has(abs)) return
    seen.add(abs)
    const pkg = await readPkg(abs)
    const script = pickScript(pkg?.scripts)
    if (!script) return
    targets.push({ id: dir === '' ? '.' : dir, label: serveLabel(pkg?.name, dir), dir, script })
  }
  await add('')
  const rootPkg = await readPkg(cwd)
  for (const dir of await workspaceDirs(cwd, rootPkg)) {
    if (targets.length >= MAX_SERVE_TARGETS) break
    await add(dir)
  }
  return targets
}

/** A target's display label: its package name, else the dir basename (`.`/root → `root`). */
function serveLabel(name: unknown, dir: string): string {
  if (typeof name === 'string' && name.trim() !== '') return name.trim()
  const base = basename(dir)
  return base === '' || base === '.' ? 'root' : base
}

interface PkgJson {
  name?: unknown
  scripts?: Record<string, unknown>
  workspaces?: unknown
}

/** Read and parse a directory's `package.json`, or undefined when absent/unreadable/malformed. */
async function readPkg(dir: string): Promise<PkgJson | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as PkgJson
  } catch {
    return undefined
  }
}

/**
 * The workspace package directories (relative to `cwd`), from `pnpm-workspace.yaml` `packages:`
 * or the package.json `workspaces` field, expanded from their globs. Order is stable (sorted).
 */
async function workspaceDirs(cwd: string, rootPkg: PkgJson | undefined): Promise<string[]> {
  const globs = await workspaceGlobs(cwd, rootPkg)
  const dirs = new Set<string>()
  for (const glob of globs) {
    for (const dir of await expandWorkspaceGlob(cwd, glob)) dirs.add(dir)
  }
  return [...dirs].sort()
}

/** The raw workspace globs: pnpm's `pnpm-workspace.yaml` wins, else npm/yarn's `workspaces`. */
async function workspaceGlobs(cwd: string, rootPkg: PkgJson | undefined): Promise<string[]> {
  try {
    const doc = parseYaml(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8')) as { packages?: unknown }
    const pkgs = doc?.packages
    if (Array.isArray(pkgs)) return pkgs.filter((g): g is string => typeof g === 'string')
  } catch {
    // no pnpm-workspace.yaml — fall through to the package.json workspaces field
  }
  const ws = rootPkg?.workspaces
  const list = Array.isArray(ws) ? ws : Array.isArray((ws as { packages?: unknown })?.packages) ? (ws as { packages: unknown[] }).packages : []
  return list.filter((g): g is string => typeof g === 'string')
}

/**
 * Expand one workspace glob to the package dirs it matches (relative to `cwd`). Handles the shapes
 * real workspaces use — a literal dir, a single `*` segment (`packages/*`), and a trailing `**`
 * (`packages/**`) — by walking the directory tree rather than pulling in a glob dependency. Negations
 * (`!`) and dirs without a `package.json` are skipped; the walk is depth-bounded for `**`.
 */
async function expandWorkspaceGlob(cwd: string, glob: string): Promise<string[]> {
  if (glob.startsWith('!')) return [] // exclusion patterns: skip, we only add positives
  const parts = glob.replace(/\/+$/, '').split('/')
  const out: string[] = []
  let visited = 0
  const walk = async (relDir: string, i: number): Promise<void> => {
    if (++visited > 2000) return // bound the tree walk so a pathological repo can't hang the picker
    if (i === parts.length) {
      if (await hasPkg(join(cwd, relDir))) out.push(relDir)
      return
    }
    const seg = parts[i]!
    if (seg === '**') {
      // Match this dir and any descendant (bounded), then continue past the `**`.
      await walk(relDir, i + 1)
      for (const child of await subdirs(join(cwd, relDir))) await walk(join(relDir, child), i)
      return
    }
    if (seg === '*') {
      for (const child of await subdirs(join(cwd, relDir))) await walk(join(relDir, child), i + 1)
      return
    }
    await walk(relDir === '' ? seg : join(relDir, seg), i + 1)
  }
  await walk('', 0)
  return out
}

/** The immediate child directory names of `dir` (excluding dotfiles and `node_modules`), or []. */
async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')).map(e => e.name)
  } catch {
    return []
  }
}

/** Whether `dir` holds a `package.json` (marking a workspace package). */
async function hasPkg(dir: string): Promise<boolean> {
  return stat(join(dir, 'package.json')).then(s => s.isFile()).catch(() => false)
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
  // A picked target (#651) serves that workspace package; otherwise fall back to the root package.
  if (opts.target) {
    const dir = opts.target.dir === '' ? opts.cwd : join(opts.cwd, opts.target.dir)
    return startDevServer(dir, opts.target.script, opts.waitMs ?? 20_000)
  }
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
  res.writeHead(200, { 'content-type': contentTypeFor(file) })
  createReadStream(file).pipe(res)
}
