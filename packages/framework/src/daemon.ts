import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { FrameworkEvent } from './events.js'
import { FRAMEWORK_DIR } from './store/index.js'
import { startDashboard, type Dashboard, type StartRunKind, type StartRunOptions, type StartRunResult, type AddProjectResult, type PreviewResult, type PreviewStatus } from './dashboard/index.js'
import { startInterventionWatcher, postDiscord, type InterventionWatcher } from './dashboard/intervention-watcher.js'
import { startPreview, type PreviewHandle } from './preview.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { isActivated } from './project.js'
import { addProject, listProjects, projectId } from './registry.js'
import { installProject, enumerateGitRepos } from './install.js'
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

/** The `.the-framework/` directory for a workspace. */
export function daemonDir(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR)
}

/**
 * Locate the CLI entry to re-invoke for a detached child, refusing to re-exec a test
 * file. Under `node --test` (or a direct `node foo.test.js`) `process.argv[1]` is the test
 * file, which re-runs the whole suite instead of the daemon/run body — and that suite calls
 * back here, so each spawn spawns another: a fork bomb. A real run passes the compiled bin
 * (or an explicit `binPath`), so the guard only ever trips in tests.
 */
function resolveSpawnBin(explicitBinPath: string | undefined): string {
  const binPath = explicitBinPath ?? process.argv[1]
  if (!binPath) throw new Error('cannot locate the framework CLI entry')
  if (!explicitBinPath && (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(binPath))) {
    throw new Error('refusing to spawn a framework process from a test entry; pass an explicit binPath')
  }
  return binPath
}

/** Spawn a detached, unref'd framework child (`node <binPath> <args...>`) that outlives us. */
function spawnDetached(binPath: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, [binPath, ...args], { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

/**
 * Make sure an activated home workspace shows up in the Projects list (#392). Best-effort
 * and idempotent (addProject dedupes by path), so it never blocks the daemon coming up.
 * Called both by the foreground daemon and by `framework --daemon`'s launcher.
 */
export async function registerHomeProject(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (await isActivated(cwd).catch(() => false)) {
    await addProject(cwd, new Date().toISOString(), undefined, env).catch(() => {})
  }
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
  for (const dir of options.context ?? []) if (typeof dir === 'string' && dir.trim()) flags.push('--context', dir)
  if (options.onBeforeMergeable) flags.push('--on-before-mergeable')
  if (options.browser) flags.push('--browser')
  return flags
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
 * The live daemon for this machine, or `undefined` when none is running. A state
 * file whose process is gone is stale — it is removed so the next `ensureDaemon`
 * starts fresh.
 */
export async function daemonStatus(env: NodeJS.ProcessEnv = process.env): Promise<DaemonState | undefined> {
  const state = await readDaemonState(env)
  if (!state) return undefined
  if (isProcessAlive(state.pid)) return state
  await rm(daemonStatePath(env), { force: true }).catch(() => {})
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
  spawnDetached(resolveSpawnBin(opts.binPath), ['--daemon-serve', '--cwd', cwd, '--port', String(port)])

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

function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
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
  const alive = isProcessAlive(state.pid)
  if (alive) {
    try {
      process.kill(state.pid, 'SIGTERM')
    } catch {
      // already gone between the check and the signal
    }
    if (!(await waitForExit(state.pid, opts.timeoutMs ?? 5000))) {
      // Ignored SIGTERM / wedged shutdown: take the port back rather than leave a zombie.
      try {
        process.kill(state.pid, 'SIGKILL')
      } catch {
        // raced us to exit
      }
      await waitForExit(state.pid, 1000)
    }
  }
  await rm(daemonStatePath(env), { force: true }).catch(() => {})
  return alive
}

/** Poll until the process is gone, or the timeout lapses. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const step = 50
  for (let waited = 0; waited <= timeoutMs; waited += step) {
    if (!isProcessAlive(pid)) return true
    await delay(step)
  }
  return !isProcessAlive(pid)
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
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** The CLI entry script to re-invoke for a dashboard-started run (#345). Default `process.argv[1]`. */
  binPath?: string
  /** Env for the global liveness path (#393). Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
  /** Called once the server has bound and recorded its state, before it blocks (#456). For the foreground banner. */
  onListening?: (state: DaemonState) => void
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
  const env = opts.env ?? process.env
  // Steering (#344): the daemon owns no run, so its Stop button and choice picks
  // append to `.the-framework/control.jsonl`; the live run tails that file. Appends
  // are best-effort — a full disk must not take the dashboard down with it.
  // The state file, the event/control logs, and the fs.watch all live under
  // `.the-framework/` — create it up front so the daemon works as the very first
  // command in a fresh workspace (before any run made the dir).
  await mkdir(daemonDir(cwd), { recursive: true })

  // Multi-project (#392): make sure an activated home repo shows up in the Projects list.
  await registerHomeProject(cwd, env)

  // Everything the dashboard drives per project — run spawning, project install, and app
  // previews — lives in the runtime, so this body stays about the daemon's own lifecycle.
  const runtime = createProjectRuntime({ cwd, env, ...(opts.binPath !== undefined ? { binPath: opts.binPath } : {}) })

  // The daemon serves the prerendered Vike + Telefunc dashboard (#405/#426): the SPA reads
  // each project's `.the-framework/events.jsonl` over a Telefunc Channel and steers over
  // control.jsonl, so there is no in-process event stream to feed here. The runtime's RPCs
  // reach the browser through the Telefunc request context. A missing bundle (a broken
  // install) surfaces as a 503 from the server.
  const clientBundleDir = await resolveDashboardBundle()
  const dashboard: Dashboard = await startDashboard({
    port,
    onStart: runtime.onStart,
    onAddProject: runtime.onAddProject,
    onPreview: runtime.onPreview,
    onStopPreview: runtime.onStopPreview,
    onPreviewStatus: runtime.onPreviewStatus,
    ...(clientBundleDir ? { clientBundleDir } : {}),
  })

  try {
    const actualPort = Number(new URL(dashboard.url).port) || port
    const state: DaemonState = { pid: process.pid, port: actualPort, url: dashboard.url, startedAt: new Date().toISOString() }
    await mkdir(dirname(daemonStatePath(env)), { recursive: true })
    await writeFile(daemonStatePath(env), JSON.stringify(state, null, 2))
    opts.onListening?.(state)
  } catch (err) {
    // Startup failed after the port was bound. Tear the server down, or it keeps the
    // event loop alive: a zombie daemon squatting the port with no state file, which
    // also wedges every later `framework` start.
    await dashboard.close()
    throw err
  }

  // Discord notifications (#627): fire on new "needs you" items even when no dashboard is open.
  // Opt-in by setting DISCORD_WEBHOOK; the browser-notification path needs no daemon watcher.
  const webhook = env.DISCORD_WEBHOOK
  let watcher: InterventionWatcher | undefined
  if (webhook) {
    watcher = startInterventionWatcher({
      projects: async () =>
        (await listProjects(undefined, env).catch(() => [])).map(p => ({
          id: p.id,
          path: p.path,
          name: basename(p.path),
          activated: true,
        })),
      onNew: items => postDiscord(webhook, items).catch(() => {}),
    })
  }

  await waitForShutdown(opts.signal)

  watcher?.stop()
  await runtime.dispose() // stop live previews (#475) so their dev servers do not outlive us
  await dashboard.close()
  await rm(daemonStatePath(env), { force: true }).catch(() => {})
}

/** Inputs to {@link createProjectRuntime}. */
interface ProjectRuntimeOptions {
  /** The daemon's home workspace; a run/preview with no project id targets it. */
  cwd: string
  /** Env for the registry lookups (#393). */
  env: NodeJS.ProcessEnv
  /** The CLI entry to spawn runs with (#345); undefined uses `process.argv[1]`. */
  binPath?: string | undefined
}

/** The per-project run + preview surface the dashboard drives, plus its teardown. */
interface ProjectRuntime {
  onStart: (prompt: string, kind: StartRunKind, options?: StartRunOptions, targetProjectId?: string) => Promise<StartRunResult>
  onAddProject: (path: string, directory: boolean) => Promise<AddProjectResult>
  onPreview: (targetProjectId?: string) => Promise<PreviewResult>
  onStopPreview: (targetProjectId?: string) => Promise<void>
  onPreviewStatus: (targetProjectId?: string) => PreviewStatus
  /** Stop every live preview so their dev servers do not outlive the daemon (#475). */
  dispose: () => Promise<void>
}

/**
 * The daemon's per-project runtime (#393): the run and preview state keyed by project id,
 * plus the RPCs the dashboard invokes over Telefunc. Each project runs at most one run and
 * one preview at a time, independently. The home `cwd` is the default target — a request
 * with no project id (or the home id) resolves to it without a registry lookup. Split out of
 * {@link runDaemon} so the daemon body reads as lifecycle and this reads as business logic.
 */
function createProjectRuntime({ cwd, env, binPath }: ProjectRuntimeOptions): ProjectRuntime {
  const homeId = projectId(resolve(cwd))
  const activeRuns = new Map<string, number>()
  const starting = new Set<string>() // reserved keys mid-spawn, to close the async gap
  const activePreviews = new Map<string, PreviewHandle>()

  // A project id resolves to its repo path via the registry; the home id (or none)
  // resolves to the daemon's own `cwd` without a lookup.
  const resolveProject = async (id: string | undefined): Promise<string | undefined> => {
    if (!id || id === homeId) return cwd
    const records = await listProjects(undefined, env).catch(() => [])
    return records.find(record => record.id === id)?.path
  }

  // Start-from-dashboard (#345): spawn `framework "<prompt>" --no-dashboard --cwd <project>`
  // as a detached child — the same spawn ensureDaemon uses for the daemon itself. The run
  // streams into the page via its tailed event log, and its gates + Stop steer through the
  // control channel (#344). One run per project (#393): while that project's child is alive,
  // Start for it is refused (the #322 runaway concern).
  const onStart = async (
    prompt: string,
    kind: StartRunKind,
    options: StartRunOptions = {},
    targetProjectId?: string,
  ): Promise<StartRunResult> => {
    const key = targetProjectId ?? homeId
    const active = activeRuns.get(key)
    if (starting.has(key) || (active !== undefined && isProcessAlive(active))) {
      return { ok: false, busy: true, error: 'a run is already active for this project; stop it or wait for it to finish' }
    }
    activeRuns.delete(key)
    starting.add(key)
    try {
      const projectCwd = await resolveProject(targetProjectId)
      if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
      let realBin: string
      try {
        realBin = resolveSpawnBin(binPath)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
      const child = spawnDetached(realBin, [...runArgs, ...startOptionFlags(options), '--no-dashboard', '--cwd', projectCwd])
      // The run narrates itself through its own `.the-framework/events.jsonl`, which the
      // dashboard streams over a Telefunc Channel; the daemon just tracks liveness.
      child.once('error', () => activeRuns.delete(key))
      child.once('exit', () => activeRuns.delete(key))
      if (child.pid !== undefined) activeRuns.set(key, child.pid)
      return { ok: true }
    } finally {
      starting.delete(key)
    }
  }

  // Add project(s) (#396): install a single repo, or every git repo directly under a
  // directory, then register each so it appears in the Projects list. installProject is
  // idempotent (an already-activated repo is a no-op success); a git failure on any target
  // aborts and surfaces as an error the dialog shows.
  const onAddProject = async (path: string, directory: boolean): Promise<AddProjectResult> => {
    // Resolve relative input against the daemon cwd, and check the directory really
    // exists first: without this a bad path reaches git as a missing cwd, which
    // surfaces as the confusing "spawn git ENOENT" rather than a path error.
    const abs = resolve(path)
    const isDir = await stat(abs).then(s => s.isDirectory()).catch(() => false)
    if (!isDir) return { ok: false, error: `path does not exist or is not a directory: ${abs}` }
    const targets = directory ? await enumerateGitRepos(abs) : [abs]
    if (!targets.length) return { ok: false, error: `no git repositories found under ${abs}` }
    let added = 0
    let alreadyActivated = 0
    for (const repo of targets) {
      const result = await installProject(repo)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.alreadyActivated) alreadyActivated++
      else added++
      await addProject(repo, new Date().toISOString()).catch(() => {})
    }
    return { ok: true, added, alreadyActivated }
  }

  // On-demand app preview (#475): one long-lived preview process per project, kept here so it
  // outlives the request that opened it and the Stop that closes it. Track a preview under its
  // key and evict it the moment it stops serving (stop, or a self-exit: crash / build error /
  // the user killing it), so previewStatus never reports a dead URL and the idempotent open
  // below never hands back a corpse instead of restarting.
  const trackPreview = (key: string, handle: PreviewHandle): void => {
    activePreviews.set(key, handle)
    void handle.exited.then(() => {
      if (activePreviews.get(key) === handle) activePreviews.delete(key)
    })
  }
  const onPreview = async (targetProjectId?: string): Promise<PreviewResult> => {
    const key = targetProjectId ?? homeId
    const existing = activePreviews.get(key)
    if (existing) return { ok: true, url: existing.url, command: existing.command }
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    try {
      const handle = await startPreview({ cwd: projectCwd })
      // A racing second open won the slot while we were booting: keep theirs, drop ours.
      const raced = activePreviews.get(key)
      if (raced) {
        await handle.stop().catch(() => {})
        return { ok: true, url: raced.url, command: raced.command }
      }
      trackPreview(key, handle)
      return { ok: true, url: handle.url, command: handle.command }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const onStopPreview = async (targetProjectId?: string): Promise<void> => {
    const key = targetProjectId ?? homeId
    const handle = activePreviews.get(key)
    if (!handle) return
    activePreviews.delete(key)
    await handle.stop().catch(() => {})
  }
  const onPreviewStatus = (targetProjectId?: string): PreviewStatus => {
    const handle = activePreviews.get(targetProjectId ?? homeId)
    return handle ? { running: true, url: handle.url, command: handle.command } : { running: false }
  }

  const dispose = async (): Promise<void> => {
    await Promise.all([...activePreviews.values()].map(p => p.stop().catch(() => {})))
    activePreviews.clear()
  }

  return { onStart, onAddProject, onPreview, onStopPreview, onPreviewStatus, dispose }
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
