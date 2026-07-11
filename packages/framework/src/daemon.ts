import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkEvent } from './events.js'
import { EVENTS_FILE, FRAMEWORK_DIR } from './store/index.js'
import { startDashboard, type Dashboard, type StartRunKind, type StartRunOptions, type StartRunResult } from './dashboard/index.js'
import { appendControl } from './control.js'
import { JsonlTailer } from './jsonl-tail.js'

/**
 * The persistent background dashboard (#302). Today the dashboard dies with the
 * foreground `framework "<prompt>"` run; this makes it a long-lived local process
 * that outlives any single run. It is a pure projection of the store: the run
 * appends its events to `.framework/events.jsonl` (unchanged), and the daemon
 * *tails* that file, pushing each new event to connected browsers. No run<->daemon
 * IPC — the file is the seam, matching "the dashboard is a projection of the event
 * stream". Steering goes the other way through `.framework/control.jsonl` (#344).
 * MVP: one project = the workspace `cwd`; multi-project is deferred (#299).
 */

/** The daemon's liveness record under `.framework/`. */
export const DAEMON_STATE_FILE = 'daemon.json'

/** The default dashboard port the daemon binds. Matches the per-run dashboard. */
export const DEFAULT_DAEMON_PORT = 4200

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

/**
 * Translate the dashboard's Global options (#314) into CLI flags for the spawned
 * run. Only enabled toggles emit a flag, so a default (all-off) start is
 * byte-identical to before. `parseArgs` on the other side accepts every one.
 */
export function startOptionFlags(options: StartRunOptions): string[] {
  const flags: string[] = []
  if (options.autopilot) flags.push('--autopilot')
  if (options.technical) flags.push('--technical')
  if (options.vanilla) flags.push('--vanilla')
  if (options.eco?.autoPlanning) flags.push('--eco-auto-planning')
  if (options.eco?.autoResearch) flags.push('--eco-auto-research')
  if (options.eco?.autoMaintenance) flags.push('--eco-auto-maintenance')
  return flags
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
 * Tails the append-only `.framework/events.jsonl` run log. The generic tailing
 * lives in {@link JsonlTailer}; this keeps the event-typed name the daemon (and
 * public API) always had.
 */
export class EventTailer extends JsonlTailer<FrameworkEvent> {}

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Poll interval backstop for the file tail, ms. Default 1000. */
  pollMs?: number
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** The CLI entry script to re-invoke for a dashboard-started run (#345). Default `process.argv[1]`. */
  binPath?: string
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
  // Steering (#344): the daemon owns no run, so its Stop button and choice picks
  // append to `.framework/control.jsonl`; the live run tails that file. Appends
  // are best-effort — a full disk must not take the dashboard down with it.
  // The state file, the event/control logs, and the fs.watch all live under
  // `.framework/` — create it up front so the daemon works as the very first
  // command in a fresh workspace (before any run made the dir).
  await mkdir(daemonDir(cwd), { recursive: true })

  // Start-from-dashboard (#345): POST /api/start spawns `framework "<prompt>"
  // --no-dashboard` as a detached child — the same spawn pattern ensureDaemon
  // uses for the daemon itself. The run streams into this page via the tailed
  // event log, and its gates + Stop steer through the control channel (#344),
  // which the run wires whenever a daemon is live. One run at a time: while the
  // last child is alive, Start is refused (the #322 runaway concern).
  let activeRunPid: number | undefined
  const startRun = (prompt: string, kind: StartRunKind, options: StartRunOptions = {}): StartRunResult => {
    if (activeRunPid !== undefined && isProcessAlive(activeRunPid)) {
      return { ok: false, busy: true, error: 'a run is already active; stop it or wait for it to finish' }
    }
    activeRunPid = undefined
    const binPath = opts.binPath ?? process.argv[1]
    if (!binPath) return { ok: false, error: 'cannot locate the framework CLI entry to spawn a run' }
    // Same fork-bomb guard as ensureDaemon: never re-exec a test file as a run.
    if (!opts.binPath && (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(binPath))) {
      return { ok: false, error: 'refusing to spawn a run from a test entry; pass an explicit binPath' }
    }
    // [Research] (#331) runs the research subcommand; its empty prompt is fine
    // (the "what" defaults to `this PR` in the CLI). A `prompt` kind (#353) is a
    // preset the user reviewed in the textarea: run it verbatim, never re-render.
    const runArgs =
      kind === 'research'
        ? ['research', ...(prompt ? [prompt] : [])]
        : kind === 'prompt'
          ? ['prompt', prompt]
          : [prompt]
    const child = spawn(process.execPath, [binPath, ...runArgs, ...startOptionFlags(options), '--no-dashboard', '--cwd', cwd], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    child.once('error', err => {
      activeRunPid = undefined
      dashboard.push({ kind: 'log', message: `✗ run failed to start: ${err.message}` })
    })
    child.once('exit', code => {
      activeRunPid = undefined
      // The run narrates its own end through the event log; only a hard failure
      // (nonzero exit with no run to tell the tale) needs the daemon's voice.
      if (code) dashboard.push({ kind: 'log', message: `✗ run exited with code ${code}` })
    })
    activeRunPid = child.pid
    // A verbatim prompt can be a whole preset document: narrate its first line only.
    const firstLine = prompt.split('\n', 1)[0] ?? ''
    const brief = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
    dashboard.push({
      kind: 'log',
      message:
        kind === 'research'
          ? `▶ research started: ${prompt || 'this PR'}`
          : kind === 'prompt'
            ? `▶ prompt run started: ${brief}`
            : `▶ run started: ${prompt}`,
    })
    return { ok: true }
  }

  const dashboard: Dashboard = await startDashboard({
    port,
    cwd,
    onStop: () => void appendControl(cwd, { kind: 'stop' }).catch(() => {}),
    onChoice: (id, pick, by) => void appendControl(cwd, { kind: 'choice', id, pick, by }).catch(() => {}),
    onStart: startRun,
  })
  const eventsPath = join(daemonDir(cwd), EVENTS_FILE)
  const tailer = new EventTailer(eventsPath, event => dashboard.push(event))

  let watcher: FSWatcher | undefined
  let poll: NodeJS.Timeout | undefined
  try {
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

    try {
      watcher = watch(daemonDir(cwd), () => void pump())
    } catch {
      // dir may not be watchable everywhere; the poll backstop still covers it
    }
    poll = setInterval(() => void pump(), opts.pollMs ?? 1000)

    const actualPort = Number(new URL(dashboard.url).port) || port
    const state: DaemonState = { pid: process.pid, port: actualPort, url: dashboard.url, startedAt: new Date().toISOString() }
    await writeFile(daemonStatePath(cwd), JSON.stringify(state, null, 2))
  } catch (err) {
    // Startup failed after the port was bound. Tear everything down, or the live
    // server + interval keep the event loop alive: a zombie daemon squatting the
    // port with no state file, which also wedges every later `framework` start.
    clearInterval(poll)
    watcher?.close()
    await dashboard.close()
    throw err
  }

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
