import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { open, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkEvent } from './events.js'
import { EVENTS_FILE, FRAMEWORK_DIR } from './store/index.js'
import { startDashboard, type Dashboard } from './dashboard/index.js'

/**
 * The persistent background dashboard (#302). Today the dashboard dies with the
 * foreground `framework "<prompt>"` run; this makes it a long-lived local process
 * that outlives any single run. It is a pure projection of the store: the run
 * appends its events to `.framework/events.jsonl` (unchanged), and the daemon
 * *tails* that file, pushing each new event to connected browsers. No run<->daemon
 * IPC — the file is the seam, matching "the dashboard is a projection of the event
 * stream". MVP: one project = the workspace `cwd`; multi-project is deferred (#299).
 */

/** The daemon's liveness record under `.framework/`. */
export const DAEMON_STATE_FILE = 'daemon.json'

/** The default dashboard port the daemon binds. Matches the per-run dashboard. */
export const DEFAULT_DAEMON_PORT = 4477

/** What a running daemon writes so a later `framework` invocation can find it. */
export interface DaemonState {
  /** The daemon process id. */
  pid: number
  /** The port the dashboard is bound to. */
  port: number
  /** The URL to open. */
  url: string
  /** ISO timestamp the daemon started. */
  startedAt: string
}

/** The `.framework/` directory for a workspace. */
export function daemonDir(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR)
}

/** The daemon state file path for a workspace. */
export function daemonStatePath(cwd: string): string {
  return join(daemonDir(cwd), DAEMON_STATE_FILE)
}

/** Read the daemon state, or `undefined` when absent or unreadable/corrupt. */
export async function readDaemonState(cwd: string): Promise<DaemonState | undefined> {
  try {
    const raw = await readFile(daemonStatePath(cwd), 'utf8')
    const data = JSON.parse(raw) as Partial<DaemonState>
    if (typeof data.pid === 'number' && typeof data.port === 'number' && typeof data.url === 'string') {
      return { pid: data.pid, port: data.port, url: data.url, startedAt: data.startedAt ?? '' }
    }
  } catch {
    // absent / unreadable / malformed -> treat as no daemon
  }
  return undefined
}

/** True when a process with this id is still running (best-effort, signal 0). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = gone; EPERM = alive but not ours (still counts as running).
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The live daemon for a workspace, or `undefined` when none is running. A state
 * file whose process is gone is stale — it is removed so the next `ensureDaemon`
 * starts fresh.
 */
export async function daemonStatus(cwd: string): Promise<DaemonState | undefined> {
  const state = await readDaemonState(cwd)
  if (!state) return undefined
  if (isProcessAlive(state.pid)) return state
  await rm(daemonStatePath(cwd), { force: true }).catch(() => {})
  return undefined
}

/** Result of {@link ensureDaemon}: the running daemon and whether we just started it. */
export interface EnsureResult {
  state: DaemonState
  /** True when a daemon was already running, false when this call spawned one. */
  alreadyRunning: boolean
}

/** Options for {@link ensureDaemon}. */
export interface EnsureDaemonOptions {
  /** Port to bind when spawning. Default {@link DEFAULT_DAEMON_PORT}. */
  port?: number
  /** How long to wait for a freshly spawned daemon to report itself, ms. Default 5000. */
  timeoutMs?: number
  /** The CLI entry script to re-invoke for the child. Default `process.argv[1]`. */
  binPath?: string
}

/**
 * Ensure a background dashboard daemon is running for `cwd`, starting one if not.
 * Idempotent: a second call while one is live just returns it. The child is
 * detached and unref'd, so it outlives this process; it reports itself by writing
 * {@link DAEMON_STATE_FILE}, which this call polls for before returning.
 */
export async function ensureDaemon(cwd: string, opts: EnsureDaemonOptions = {}): Promise<EnsureResult> {
  const existing = await daemonStatus(cwd)
  if (existing) return { state: existing, alreadyRunning: true }

  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const binPath = opts.binPath ?? process.argv[1]
  if (!binPath) throw new Error('cannot locate the framework CLI entry to spawn the daemon')

  // Never re-exec a test file as the daemon. Under `node --test` (or a direct
  // `node foo.test.js`), process.argv[1] is the test file, which re-runs the whole
  // suite instead of the daemon body — and that suite calls back here, so each spawn
  // spawns another: a fork bomb. A real run passes the compiled bin as argv[1] (or an
  // explicit binPath), so this only ever trips in tests.
  if (!opts.binPath && (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(binPath))) {
    throw new Error('refusing to spawn the dashboard daemon from a test entry; pass an explicit binPath')
  }

  const child = spawn(process.execPath, [binPath, '--daemon', '--cwd', cwd, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  const state = await waitForDaemon(cwd, opts.timeoutMs ?? 5000)
  if (!state) throw new Error('the daemon did not come up in time')
  return { state, alreadyRunning: false }
}

/** Poll for the daemon's state file to appear and its process to be alive. */
async function waitForDaemon(cwd: string, timeoutMs: number): Promise<DaemonState | undefined> {
  const step = 100
  for (let waited = 0; waited <= timeoutMs; waited += step) {
    const state = await daemonStatus(cwd)
    if (state) return state
    await delay(step)
  }
  return undefined
}

function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

/**
 * Stop the workspace's daemon, if any. Returns true when one was running and got
 * a termination signal. The daemon removes its own state file on exit; a stale
 * file (dead process) is cleaned up here.
 */
export async function stopDaemon(cwd: string): Promise<boolean> {
  const state = await readDaemonState(cwd)
  if (!state) return false
  const alive = isProcessAlive(state.pid)
  if (alive) {
    try {
      process.kill(state.pid, 'SIGTERM')
    } catch {
      // already gone between the check and the signal
    }
  }
  await rm(daemonStatePath(cwd), { force: true }).catch(() => {})
  return alive
}

/**
 * Tails an append-only JSONL event log, calling `onEvent` for each complete line
 * as it is written. Reads only the bytes appended since the last {@link pull},
 * buffering a torn trailing line until its newline arrives. A file that shrinks
 * (a fresh run truncated the log) resets to the start so the new run is picked up.
 */
export class EventTailer {
  private offset = 0
  private partial = ''
  private lastMtimeMs = 0

  constructor(
    private readonly path: string,
    private readonly onEvent: (event: FrameworkEvent) => void,
  ) {}

  /** Read and dispatch any events appended since the previous call. */
  async pull(): Promise<void> {
    let fd
    try {
      fd = await open(this.path, 'r')
    } catch {
      return // not created yet (no run has started)
    }
    try {
      const { size, mtimeMs } = await fd.stat()
      // A fresh run truncates the log in place (same inode). Detect it two ways: the
      // file shrank below what we consumed, or it was rewritten to the same length
      // (size unchanged but mtime advanced). Either way, re-read from the top.
      const rewritten = size === this.offset && this.offset > 0 && mtimeMs > this.lastMtimeMs
      if (size < this.offset || rewritten) {
        this.offset = 0
        this.partial = ''
      }
      this.lastMtimeMs = mtimeMs
      if (size === this.offset) return
      const buf = Buffer.alloc(size - this.offset)
      await fd.read(buf, 0, buf.length, this.offset)
      this.offset = size
      this.partial += buf.toString('utf8')
      const lines = this.partial.split('\n')
      this.partial = lines.pop() ?? '' // trailing fragment with no newline yet
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          this.onEvent(JSON.parse(trimmed) as FrameworkEvent)
        } catch {
          // a torn/half-written line — skip it; the store never rewrites history
        }
      }
    } finally {
      await fd.close()
    }
  }
}

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Poll interval backstop for the file tail, ms. Default 1000. */
  pollMs?: number
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
}

/**
 * The daemon body — run in the detached child. Starts the dashboard, seeds it
 * from the existing log, then tails `.framework/events.jsonl` (an `fs.watch` plus
 * a poll backstop, since `fs.watch` is unreliable across platforms), pushing each
 * new event to browsers. Resolves on SIGINT/SIGTERM after tearing the dashboard
 * down and removing its state file.
 */
export async function runDaemon(cwd: string, opts: RunDaemonOptions = {}): Promise<void> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const dashboard: Dashboard = await startDashboard({ port })
  const eventsPath = join(daemonDir(cwd), EVENTS_FILE)
  const tailer = new EventTailer(eventsPath, event => dashboard.push(event))

  // Seed from whatever is already logged, then keep up with appends.
  await tailer.pull()
  let pulling = false
  const pump = async (): Promise<void> => {
    if (pulling) return
    pulling = true
    try {
      await tailer.pull()
    } finally {
      pulling = false
    }
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(daemonDir(cwd), () => void pump())
  } catch {
    // dir may not be watchable everywhere; the poll backstop still covers it
  }
  const poll = setInterval(() => void pump(), opts.pollMs ?? 1000)

  const actualPort = Number(new URL(dashboard.url).port) || port
  const state: DaemonState = { pid: process.pid, port: actualPort, url: dashboard.url, startedAt: new Date().toISOString() }
  await writeFile(daemonStatePath(cwd), JSON.stringify(state, null, 2))

  await waitForShutdown(opts.signal)

  clearInterval(poll)
  watcher?.close()
  await dashboard.close()
  await rm(daemonStatePath(cwd), { force: true }).catch(() => {})
}

/** Resolve on SIGINT/SIGTERM, or when the optional abort signal fires. */
function waitForShutdown(signal?: AbortSignal): Promise<void> {
  return new Promise(resolvePromise => {
    if (signal?.aborted) return resolvePromise()
    const done = (): void => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      signal?.removeEventListener('abort', done)
      resolvePromise()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
    signal?.addEventListener('abort', done, { once: true })
  })
}
