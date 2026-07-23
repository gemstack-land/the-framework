import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, isAbsolute } from 'node:path'
import type { FrameworkEvent } from './events.js'
import { FRAMEWORK_DIR, isPidAlive, reconcileOrphanedRuns } from './store/index.js'
import { startDashboard, type Dashboard, type StartRunOptions } from './dashboard/index.js'
import { createProjectRuntime, delay, resolveSpawnBin, spawnDetached, terminate } from './daemon-runtime.js'
export { startOptionFlags } from './daemon-runtime.js'
import { defaultQuotaSource } from './dashboard/quota.js'
import { startBackgroundServices, resumeSuspendedRuns } from './daemon-services.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { isActivated } from './project.js'
import { addProject, ensureDaemonToken, listProjects } from './registry.js'
import { JsonlTailer } from './jsonl-tail.js'

/**
 * The persistent background dashboard (#302). Today the dashboard dies with the
 * foreground `framework "<prompt>"` run; this makes it a long-lived local process
 * that outlives any single run. It is a pure projection of the store: the run
 * appends its events to `.the-framework/events.jsonl` (unchanged), and the daemon
 * *tails* that file, pushing each new event to connected browsers. No run<->daemon
 * IPC — the file is the seam, matching "the dashboard is a projection of the event
 * stream". Steering goes the other way through `.the-framework/control.jsonl` (#344).
 *
 * One daemon per machine (#393): liveness lives in a single global file next to the
 * registry ({@link daemonStatePath}), not per-workspace, so `framework` in any repo
 * finds the same daemon. Runs and steering are keyed per project: the daemon spawns
 * each run with `--cwd <project path>` and appends its control entries to that
 * project's own `control.jsonl`. Its own `cwd` is just the home project it streams by
 * default (per-project live streaming is folded in with the dashboard rebuild, #405).
 */

/**
 * The daemon's liveness record filename. A single global file (one daemon per
 * machine, #393), resolved by {@link daemonStatePath} beside the registry.
 */
export const DAEMON_STATE_FILE = 'the-framework-daemon.json'

/** The default dashboard port the daemon binds. Matches the per-run dashboard. */
export const DEFAULT_DAEMON_PORT = 4200

/** The default bind host (#1051): localhost only, so the daemon is unreachable off the machine. */
export const DEFAULT_DAEMON_HOST = '127.0.0.1'

/**
 * True when `host` is a loopback address the browser reaches without leaving the machine (#1051).
 * A bind-all (`0.0.0.0`, `::`) or a routable address is not, and gates behind the shared token.
 */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')
}

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
  /** The host the dashboard is bound to (#1051); absent in state files written before this shipped. */
  host?: string
}

/** The `.the-framework/` directory for a workspace. */
export function daemonDir(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR)
}

/** True when `child` lives strictly inside `parent` (not equal, not outside). */
export function isNestedWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Make sure an activated home workspace shows up in the Projects list (#392). Best-effort
 * and idempotent (addProject dedupes by path), so it never blocks the daemon coming up.
 * Called both by the foreground daemon and by `framework --daemon`'s launcher.
 *
 * Skips a cwd that lives inside an already-tracked project (#647): the daemon creates
 * `.the-framework/` for its own state, so running it from a subfolder of a repo (e.g. the
 * package dir the binary lives in) would otherwise keep re-adding a nested duplicate.
 */
export async function registerHomeProject(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!(await isActivated(cwd).catch(() => false))) return
  const existing = await listProjects(undefined, env).catch(() => [])
  if (existing.some(p => isNestedWithin(cwd, p.path))) return
  await addProject(cwd, new Date().toISOString(), undefined, env).catch(() => {})
}

/**
 * The global daemon state file path (#393): a single file beside the registry, so
 * there is one daemon per machine. `$XDG_CONFIG_HOME/the-framework-daemon.json` when
 * set, else the dotted `$HOME/.the-framework-daemon.json` — mirroring `registryPath`.
 * `env` is injectable so tests never touch the real home.
 */
export function daemonStatePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, DAEMON_STATE_FILE)
  return join(env.HOME ?? '', '.' + DAEMON_STATE_FILE)
}

/** Read the daemon state, or `undefined` when absent or unreadable/corrupt. */
export async function readDaemonState(env: NodeJS.ProcessEnv = process.env): Promise<DaemonState | undefined> {
  try {
    const raw = await readFile(daemonStatePath(env), 'utf8')
    const data = JSON.parse(raw) as Partial<DaemonState>
    if (typeof data.pid === 'number' && typeof data.port === 'number' && typeof data.url === 'string') {
      return {
        pid: data.pid,
        port: data.port,
        url: data.url,
        startedAt: data.startedAt ?? '',
        // #1051: only present once an upgraded daemon wrote it; an older file reads as no host.
        ...(typeof data.host === 'string' ? { host: data.host } : {}),
      }
    }
  } catch {
    // absent / unreadable / malformed -> treat as no daemon
  }
  return undefined
}

/** True when a process with this id is still running (best-effort, signal 0). The store's
 * {@link isPidAlive} under the daemon's historical public name -- the two were byte-identical. */
export { isPidAlive as isProcessAlive } from './store/index.js'

/**
 * The live daemon for this machine, or `undefined` when none is running. A state file
 * whose process is gone is reported as no daemon, but left alone (#922): this is a read,
 * and it used to delete the file. One check against a stale pid then unregistered a
 * daemon that was actually running, for good — the file is only written at startup, so
 * `framework stop` could no longer find it and `framework --daemon` spawned a second
 * daemon that died on the bound port. Removal belongs to the two owners: the daemon's own
 * teardown and {@link stopDaemon}.
 */
export async function daemonStatus(env: NodeJS.ProcessEnv = process.env): Promise<DaemonState | undefined> {
  const state = await readDaemonState(env)
  if (!state) return undefined
  return isPidAlive(state.pid) ? state : undefined
}

/**
 * Record this daemon as the machine's live one, atomically (#922): a temp file in the same
 * directory, then a rename, so a concurrent reader sees either the whole old file or the
 * whole new one. A torn read parses as malformed, which reads as "no daemon".
 */
export async function writeDaemonState(state: DaemonState, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = daemonStatePath(env)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(state, null, 2))
  await rename(temp, path)
}

/**
 * Remove the state file only while it still names `pid` (#922). The daemon's teardown must
 * not delete a record another daemon has since written, which is what an unconditional
 * remove does when the two overlap by a moment.
 */
async function removeDaemonStateIfOwned(pid: number, env: NodeJS.ProcessEnv): Promise<void> {
  const state = await readDaemonState(env)
  if (state && state.pid !== pid) return
  await rm(daemonStatePath(env), { force: true }).catch(() => {})
}

/** How often a running daemon re-asserts its state file, ms (#922). */
export const DAEMON_STATE_HEARTBEAT_MS = 5000

/** A running daemon's state-file heartbeat: stoppable, and awaitable in tests. */
export interface DaemonStateHeartbeat {
  stop: () => void
  /** Re-assert once, now. The interval calls this; tests call it instead of waiting. */
  beat: () => Promise<void>
}

/**
 * Keep the state file saying this daemon is live (#922). A missing file, or one naming a
 * process that is gone, is rewritten; a file naming a different *live* daemon is left
 * alone, since that one owns the port and this one is the impostor.
 *
 * The timer is unref'd: re-asserting a record is not a reason to hold the process open.
 */
export function startDaemonStateHeartbeat(
  state: DaemonState,
  env: NodeJS.ProcessEnv = process.env,
  everyMs: number = DAEMON_STATE_HEARTBEAT_MS,
): DaemonStateHeartbeat {
  let stopped = false
  const beat = async (): Promise<void> => {
    if (stopped) return
    const current = await readDaemonState(env)
    if (current && (current.pid === state.pid || isPidAlive(current.pid))) return
    await writeDaemonState(state, env).catch(() => {})
  }
  const timer = setInterval(() => void beat(), everyMs)
  timer.unref()
  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
    beat,
  }
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
  /** Host to bind when spawning (#1051). Default {@link DEFAULT_DAEMON_HOST}; a non-loopback address
   * generates and requires the shared token. */
  host?: string
  /** How long to wait for a freshly spawned daemon to report itself, ms. Default 5000. */
  timeoutMs?: number
  /** The CLI entry script to re-invoke for the child. Default `process.argv[1]`. */
  binPath?: string
  /** Env for the global liveness path (#393). Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
}

/**
 * Ensure the machine's background dashboard daemon is running, starting one (homed
 * at `cwd`) if not. Idempotent and machine-global (#393): a second call from any
 * repo while one is live just returns it. The child is detached and unref'd, so it
 * outlives this process; it reports itself by writing {@link DAEMON_STATE_FILE},
 * which this call polls for before returning.
 */
export async function ensureDaemon(cwd: string, opts: EnsureDaemonOptions = {}): Promise<EnsureResult> {
  const existing = await daemonStatus(opts.env)
  if (existing) return { state: existing, alreadyRunning: true }

  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const args = ['--daemon-serve', '--cwd', cwd, '--port', String(port)]
  // #1051: forward a non-loopback bind to the detached child, which generates the token there.
  if (opts.host !== undefined) args.push('--host', opts.host)
  spawnDetached(resolveSpawnBin(opts.binPath), args)

  const state = await waitForDaemon(opts.env, opts.timeoutMs ?? 5000)
  if (!state) throw new Error('the daemon did not come up in time')
  return { state, alreadyRunning: false }
}

/** Poll for the daemon's global state file to appear and its process to be alive. */
async function waitForDaemon(env: NodeJS.ProcessEnv | undefined, timeoutMs: number): Promise<DaemonState | undefined> {
  const step = 100
  for (let waited = 0; waited <= timeoutMs; waited += step) {
    const state = await daemonStatus(env)
    if (state) return state
    await delay(step)
  }
  return undefined
}

/** Options for {@link stopDaemon}. */
export interface StopDaemonOptions {
  /** Grace period for SIGTERM before escalating to SIGKILL, ms. Default 5000. */
  timeoutMs?: number
}

/**
 * Stop the machine's daemon, if any (#393). Returns true when one was running and
 * got a termination signal. The daemon removes its own state file on exit; a stale
 * file (dead process) is cleaned up here.
 *
 * Waits for the process to actually exit before returning (#514): the port is only
 * free once it is gone, so `stop` followed by an immediate restart would otherwise
 * race it — the new daemon hits EADDRINUSE, never reports itself ("the daemon did not
 * come up in time"), and the old one keeps serving a stale bundle with no state file.
 * SIGTERM is escalated to SIGKILL if the grace period lapses.
 */
export async function stopDaemon(env: NodeJS.ProcessEnv = process.env, opts: StopDaemonOptions = {}): Promise<boolean> {
  const state = await readDaemonState(env)
  if (!state) return false
  const alive = await terminate(state.pid, opts.timeoutMs ?? 5000)
  await rm(daemonStatePath(env), { force: true }).catch(() => {})
  return alive
}

/**
 * Tails the append-only `.the-framework/events.jsonl` run log. The generic tailing
 * lives in {@link JsonlTailer}; this keeps the event-typed name the daemon (and
 * public API) always had.
 */
export class EventTailer extends JsonlTailer<FrameworkEvent> {}

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind (#1051). Default {@link DEFAULT_DAEMON_HOST}; a non-loopback address generates and
   * requires the shared token, and every route is then gated behind it. */
  host?: string
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** The CLI entry script to re-invoke for a dashboard-started run (#345). Default `process.argv[1]`. */
  binPath?: string
  /** Env for the global liveness path (#393). Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
  /** Called once the server has bound and recorded its state, before it blocks (#456). For the foreground banner. */
  onListening?: (state: DaemonState) => void
  /** How often to re-assert the state file, ms (#922). Default {@link DAEMON_STATE_HEARTBEAT_MS}; for tests. */
  heartbeatMs?: number
}

/**
 * The daemon body — run in the foreground by bare `framework`, or in the detached child that
 * `framework --daemon` spawns (#456). Serves the prerendered Vike + Telefunc
 * dashboard (#405/#426): the SPA reads each project's `.the-framework/events.jsonl` over a
 * Telefunc Channel and steers over control.jsonl, so the daemon just serves the bundle,
 * spawns runs, and records its liveness. Resolves on SIGINT/SIGTERM after tearing the
 * dashboard down and removing its state file.
 */
export async function runDaemon(cwd: string, opts: RunDaemonOptions = {}): Promise<void> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const host = opts.host ?? DEFAULT_DAEMON_HOST
  const env = opts.env ?? process.env
  // #1051: a non-loopback bind reaches the network, where a daemon that spawns processes is RCE for
  // anyone who finds the port, so generate + persist the shared token the request guard requires. A
  // loopback bind needs none, so the local zero-config path stays byte-identical.
  const token = isLoopbackHost(host) ? undefined : await ensureDaemonToken(undefined, env)
  // Steering (#344): the daemon owns no run, so its Stop button and choice picks
  // append to `.the-framework/control.jsonl`; the live run tails that file. Appends
  // are best-effort — a full disk must not take the dashboard down with it.
  // The state file, the event/control logs, and the fs.watch all live under
  // `.the-framework/` — create it up front so the daemon works as the very first
  // command in a fresh workspace (before any run made the dir).
  await mkdir(daemonDir(cwd), { recursive: true })

  // Multi-project (#392): make sure an activated home repo shows up in the Projects list.
  await registerHomeProject(cwd, env)

  // Crash recovery (#642): a fresh daemon drives no in-flight run, so any run a dead
  // process left marked `running` is orphaned — it would show as active forever with a
  // no-op Stop. Reconcile them to `stopped` across every registered project at boot.
  for (const record of await listProjects(undefined, env).catch(() => [])) {
    const fixed = await reconcileOrphanedRuns(record.path).catch(() => 0)
    if (fixed > 0) console.log(`[framework] reconciled ${fixed} orphaned session(s) in ${basename(record.path)}`)
  }

  // Everything the dashboard drives per project — run spawning, project install, and app
  // previews — lives in the runtime, so this body stays about the daemon's own lifecycle.
  const runtime = createProjectRuntime({ cwd, env, ...(opts.binPath !== undefined ? { binPath: opts.binPath } : {}) })

  // The daemon serves the prerendered Vike + Telefunc dashboard (#405/#426): the SPA reads
  // each project's `.the-framework/events.jsonl` over a Telefunc Channel and steers over
  // control.jsonl, so there is no in-process event stream to feed here. The runtime's RPCs
  // reach the browser through the Telefunc request context. A missing bundle (a broken
  // install) surfaces as a 503 from the server.
  const clientBundleDir = await resolveDashboardBundle()
  // Owned here rather than left to the dashboard (#685): auto PM has to consult the same
  // long-lived meter the usage panel draws, and a second poller would double a rate-limited read.
  const quota = defaultQuotaSource()
  const dashboard: Dashboard = await startDashboard({
    host,
    port,
    quota,
    onStart: runtime.onStart,
    onAddProject: runtime.onAddProject,
    preview: runtime.preview,
    // Relay a run to/from a connected device (#1067): the events source streams a run this daemon
    // is relaying, and the `/_relay/*` endpoints let another daemon run a session here.
    eventsSource: runtime.remoteEventsSource,
    relay: { tailEvents: runtime.tailRelayEvents },
    ...(token ? { token } : {}),
    ...(clientBundleDir ? { clientBundleDir } : {}),
  })

  // Re-asserts the state file for as long as this daemon runs (#922), so anything that
  // deletes it heals within a tick instead of lasting until a restart.
  let selfHeal: DaemonStateHeartbeat | undefined
  try {
    const actualPort = Number(new URL(dashboard.url).port) || port
    const state: DaemonState = { pid: process.pid, port: actualPort, host, url: dashboard.url, startedAt: new Date().toISOString() }
    await writeDaemonState(state, env)
    opts.onListening?.(state)
    selfHeal = startDaemonStateHeartbeat(state, env, opts.heartbeatMs ?? DAEMON_STATE_HEARTBEAT_MS)
  } catch (err) {
    // Startup failed after the port was bound. Tear the server down, or it keeps the
    // event loop alive: a zombie daemon squatting the port with no state file, which
    // also wedges every later `framework` start.
    selfHeal?.stop()
    await dashboard.close()
    throw err
  }

  // Every background start is a verbatim prompt run (#353): these are preset prompts and chat
  // text, not build intents to scaffold from.
  const startRun = (prompt: string, options: StartRunOptions, id: string) => runtime.onStart(prompt, 'prompt', options, id)

  // Resume what the last daemon suspended (#923), and bring up everything that runs in the
  // background beside serving the dashboard: the Discord watchers, auto PM, the conversation
  // committer, and the chatbot. Fire-and-forget: a resume that fails must not stop the daemon
  // coming up, and there is nothing to return to.
  void resumeSuspendedRuns(env, startRun, console.log).catch(err => console.log(`[framework] could not resume suspended sessions: ${err}`))
  const services = startBackgroundServices({
    cwd,
    env,
    dashboardUrl: dashboard.url,
    quota,
    startRun,
    activeRunCount: runtime.activeRunCount,
    log: console.log,
  })

  await waitForShutdown(opts.signal)

  // Nothing may start or steer a run from here on, so the background services go first (#923):
  // auto PM or a Discord message arriving mid-shutdown would start one while we stop the rest.
  services.quiesce()
  // Stop the runs this daemon spawned, before the previews they may be serving. Left running they
  // are orphans nothing tracks; stopped here they are recorded and resumed on the next boot.
  const suspended = await runtime.suspendRuns().catch(() => 0)
  if (suspended > 0) console.log(`[framework] suspended ${suspended} session(s); they resume when the daemon starts again`)
  // Now that the runs' last turns are on disk, commit them (#912) — otherwise an uncommitted chat
  // sits until a human notices, which is the exact gap that service exists to close.
  const conversations = await services.flushConversations()
  if (conversations > 0) console.log(`[framework] committed conversations in ${conversations} project(s)`)
  // Stopped here as well as by the dashboard: a broken install serves 503s without ever taking
  // ownership of the source we handed in, and that poller would go on reading by itself.
  quota.stop()
  await runtime.dispose() // stop live previews (#475) so their dev servers do not outlive us
  await dashboard.close()
  // Stop re-asserting before removing, or the heartbeat writes the record back (#922).
  selfHeal?.stop()
  await removeDaemonStateIfOwned(process.pid, env)
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
