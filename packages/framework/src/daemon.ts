import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import type { FrameworkEvent } from './events.js'
import {
  FRAMEWORK_DIR,
  reconcileOrphanedRuns,
  runIdFromStartedAt,
  addWorktree,
  runBranchName,
  linkDependencies,
  excludeDependencyLinks,
  archiveWorktreeRun,
  restoreArchivedRun,
  attachWorktree,
  worktreePath,
  listRuns,
  commitPendingWork,
  currentBranch,
  removeWorktree,
  pruneWorktrees,
  readLiveMetas,
  isSafeRunId,
} from './store/index.js'
import { startDashboard, type Dashboard, type StartRunKind, type StartRunOptions, type StartRunResult, type AddProjectResult, type PreviewResult, type PreviewStatus } from './dashboard/index.js'
import { startInterventionWatcher, postDiscord, type InterventionWatcher } from './dashboard/intervention-watcher.js'
import { buildInterventions } from './dashboard/interventions.js'
import { startActivityWatcher, postActivityDiscord, type ActivityWatcher } from './dashboard/activity-watcher.js'
import { defaultQuotaSource } from './dashboard/quota.js'
import { startAutoPm, AUTO_PM_JOBS } from './auto-pm.js'
import { promoteQueue } from './queue-promote.js'
import { findTodoBacklog } from './todo-loop.js'
import { startPreview, detectServeTargets, type PreviewHandle, type ServeTarget } from './preview.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { isActivated } from './project.js'
import { addProject, listProjects, projectId, readPreferences, readProjectPreferences, resolvePreferences } from './registry.js'
import { runOptionsFromPreferences } from './run-options.js'
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
 * Translate the dashboard's Global options (#314) into CLI flags for the spawned
 * run. Only enabled toggles emit a flag, so a default (all-off) start is
 * byte-identical to before. `parseArgs` on the other side accepts every one.
 */
export function startOptionFlags(options: StartRunOptions): string[] {
  const flags: string[] = []
  if (options.autopilot) flags.push('--autopilot')
  if (options.technical) flags.push('--technical')
  if (options.vanilla) flags.push('--vanilla')
  if (options.transparent) flags.push('--transparent')
  if (options.eco?.autoPlanning) flags.push('--eco-auto-planning')
  if (options.eco?.autoResearch) flags.push('--eco-auto-research')
  if (options.eco?.autoMaintenance) flags.push('--eco-auto-maintenance')
  for (const dir of options.context ?? []) if (typeof dir === 'string' && dir.trim()) flags.push('--context', dir)
  if (options.onBeforeMergeable) flags.push('--on-before-mergeable')
  if (options.browser) flags.push('--browser')
  if (typeof options.model === 'string' && options.model.trim()) flags.push('--model', options.model.trim())
  // Agent (#650): only non-default (codex) needs a flag; claude is the CLI default.
  if (typeof options.agent === 'string' && options.agent.trim() && options.agent !== 'claude') {
    flags.push('--agent', options.agent.trim())
  }
  // Unattended (#846): nobody is at the keyboard, so gates take the recommended option
  // rather than park for an answer that is not coming.
  if (options.unattended) flags.push('--unattended')
  // Resume a finished run's session (#720): the spawned run continues that conversation.
  if (typeof options.resumeSession === 'string' && options.resumeSession.trim()) {
    flags.push('--resume-session', options.resumeSession.trim())
  }
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
    port,
    quota,
    onStart: runtime.onStart,
    onAddProject: runtime.onAddProject,
    onPreview: runtime.onPreview,
    onServeTargets: runtime.onServeTargets,
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
  // Two gates: a `DISCORD_WEBHOOK` (where to post) and the per-user `notifyDiscord` preference
  // (whether to). The pref is checked at post time, not watcher start, so the header toggle takes
  // effect without a daemon restart — and the watcher keeps observing while off, so flipping it on
  // starts from now rather than blasting the whole open backlog.
  const webhook = env.DISCORD_WEBHOOK
  const listSummaries = async () =>
    (await listProjects(undefined, env).catch(() => [])).map(p => ({
      id: p.id,
      path: p.path,
      name: basename(p.path),
      activated: true,
    }))
  const readPrefs = () =>
    readPreferences(undefined, env).catch(() => ({}) as Awaited<ReturnType<typeof readPreferences>>)
  /**
   * The run options a project's settings imply (#858), global tier overlaid with its own (#840).
   * The same mapping the launcher uses, so a run started by the daemon and a run started by hand
   * differ only in who asked for it. An unreadable tier falls back to empty rather than failing
   * the start: the defaults are what the run would have used anyway.
   */
  const resolvedRunOptions = async (id: string) => {
    const global = await readPrefs()
    const project = await readProjectPreferences(id, undefined, env).catch(() => undefined)
    return runOptionsFromPreferences(resolvePreferences(global, project))
  }
  let watcher: InterventionWatcher | undefined
  let activityWatcher: ActivityWatcher | undefined
  if (webhook) {
    watcher = startInterventionWatcher({
      projects: listSummaries,
      // Pass the daemon's own URL so a paused-run item (#636) can link back to the dashboard.
      build: projects => buildInterventions(projects, { dashboardUrl: dashboard.url }),
      onNew: async items => {
        const prefs = await readPrefs()
        // Double-gated like activity below: the method (`notifyDiscord`) AND the category
        // (`notifyHumanIntervention`) must both be on. The category defaults on, so `?? true` —
        // do NOT copy activity's plain `!prefs.x`, which would silence the baseline by default.
        if (!prefs.notifyDiscord || (prefs.notifyHumanIntervention ?? true) === false) return
        await postDiscord(webhook, items).catch(() => {})
      },
    })
    // The default-off "New activity" category (#627): the same Discord path for run started/finished
    // events. Double-gated at post time so the header toggles take effect without a daemon restart —
    // the category (`notifyNewActivity`) AND the method (`notifyDiscord`) must both be on. The watcher
    // keeps observing while off, so flipping it on starts from now rather than blasting the backlog.
    activityWatcher = startActivityWatcher({
      projects: listSummaries,
      onNew: async items => {
        const prefs = await readPrefs()
        if (!prefs.notifyDiscord || !prefs.notifyNewActivity) return
        await postActivityDiscord(webhook, items).catch(() => {})
      },
    })
  }

  // Auto PM (#685/#773): while the queue is dry and there is quota to spare, harvest quick-wins
  // and spike & plan tickets rather than let the day's allowance expire unused. Gated on the
  // `autoPm` preference, read per tick so the toggle takes effect without a daemon restart.
  const autoPm = startAutoPm({
    projects: listSummaries,
    jobs: AUTO_PM_JOBS,
    enabled: async () => (await readPrefs()).autoPm === true,
    backlogEmpty: async project => (await findTodoBacklog(project.path)) === undefined,
    activeRuns: project => runtime.activeRunCount(project.id),
    // The user's own configured limits are the gate (#870): auto PM has no budget notion of its own.
    quota: async () => ({ status: (await quota.read()).limits }),
    start: async (project, job) => {
      // The settings a launcher-started run would have used (#858). `onStart` does not resolve
      // these itself, so passing nothing meant an unattended run silently ignored the project's
      // agent and model. `unattended` is forced on top: it is a property of nobody watching, not
      // a preference, and without it every gate parks forever (#846).
      const options = await resolvedRunOptions(project.id)
      const result = await runtime.onStart(job.prompt, 'prompt', { ...options, unattended: true }, project.id)
      return result.ok ? result.runId : undefined
    },
    // The daemon promotes the queue, never the agent (#852): the run stays sandboxed in its
    // worktree, and one known file is copied across once it has finished cleanly.
    promote: async (project, runId) => {
      const run = (await listRuns(project.path).catch(() => [])).find(r => r.id === runId)
      // Unknown or still going: not settled, so it is tried again next tick.
      if (!run || run.status === 'running') return { settled: false, promoted: false }
      const outcome = await promoteQueue(project.path, run)
      if (!outcome.promoted) console.log(`[framework] auto PM: ${outcome.reason} (${runId})`)
      // A finished run is settled either way -- one that wrote no queue is not going to start.
      // The exception is a checkout busy with the user's own queue edits, which is worth retrying.
      const retry = !outcome.promoted && outcome.reason === 'the checkout has uncommitted queue changes'
      return { settled: !retry, promoted: outcome.promoted }
    },
    log: message => console.log(message),
  })

  await waitForShutdown(opts.signal)

  autoPm.stop()
  // Stopped here as well as by the dashboard: a broken install serves 503s without ever taking
  // ownership of the source we handed in, and that poller would go on reading by itself.
  quota.stop()
  watcher?.stop()
  activityWatcher?.stop()
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
  onPreview: (targetProjectId?: string, targetId?: string) => Promise<PreviewResult>
  onServeTargets: (targetProjectId?: string) => Promise<ServeTarget[]>
  onStopPreview: (targetProjectId?: string) => Promise<void>
  onPreviewStatus: (targetProjectId?: string) => PreviewStatus
  /** Live runs on a project (#685), so a background job can tell an idle project from a busy one. */
  activeRunCount: (targetProjectId: string) => number
  /** Stop every live preview so their dev servers do not outlive the daemon (#475). */
  dispose: () => Promise<void>
}

/**
 * The daemon's per-project runtime (#393): the run and preview state keyed by project id,
 * plus the RPCs the dashboard invokes over Telefunc. A project runs any number of concurrent
 * runs (each in its own worktree, #736) and one preview. The home `cwd` is the default target — a request
 * with no project id (or the home id) resolves to it without a registry lookup. Split out of
 * {@link runDaemon} so the daemon body reads as lifecycle and this reads as business logic.
 */
function createProjectRuntime({ cwd, env, binPath }: ProjectRuntimeOptions): ProjectRuntime {
  const homeId = projectId(resolve(cwd))
  // Live run pids, keyed per run rather than per project (#736) — see onStart for the key.
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

  /**
   * The checkout a *session* is working in (#797): its own worktree, else the project's tree.
   * Same resolution the read and control RPCs use — live metas first, then the directory, which
   * exists before the run has written its `run.json`.
   */
  const resolveRunCheckout = async (projectCwd: string, runId: string | undefined): Promise<string> => {
    if (!runId || !isSafeRunId(runId)) return projectCwd
    const live = await readLiveMetas(projectCwd).catch(() => [])
    const running = live.find(run => run.id === runId)?.cwd
    if (running) return running
    const path = worktreePath(projectCwd, runId)
    return (await stat(path).then(s => s.isDirectory()).catch(() => false)) ? path : projectCwd
  }

  /**
   * The checkout a run gets (#736). Each run is given its own git worktree under the
   * project's `.the-framework/worktrees/<runId>`, on a `the-framework/run-<runId>` branch,
   * so N runs on one repo never fight over the working tree — and the user's own checkout,
   * uncommitted work included, is left untouched.
   *
   * A project that cannot provide one (not a git repo, or any git failure) falls back to the
   * main checkout, which is exactly the pre-#736 behavior — and keeps its pre-#736 limit of
   * one run at a time, since those runs *would* collide. Signalled by the absent `runId`.
   */
  /**
   * Put a continued run (#762) back in its own checkout: the same worktree if it was retained, else
   * its own branch checked out fresh. Its archived history is restored into the checkout so the run
   * reopens its log rather than starting empty, which is what keeps it one row.
   *
   * The branch is the session's if the agent named one, else the run-id branch it started on.
   * Returns undefined when none of that is possible, so the caller can fall back to a new run.
   */
  const continueWorkspace = async (projectCwd: string, runId: string): Promise<{ cwd: string; runId: string } | undefined> => {
    try {
      const path = worktreePath(projectCwd, runId)
      const existing = await stat(path).then(s => s.isDirectory()).catch(() => false)
      if (!existing) {
        const archived = (await listRuns(projectCwd).catch(() => [])).find(run => run.id === runId)
        const branch = archived?.sessionName ? `the-framework/${archived.sessionName}` : runBranchName(runId)
        await attachWorktree(projectCwd, { runId, branch })
        await linkDependencies(projectCwd, path).catch(() => [])
      }
      await restoreArchivedRun(projectCwd, path, runId).catch(() => false)
      return { cwd: path, runId }
    } catch (err) {
      console.log(`[framework] could not continue session ${runId} (${err instanceof Error ? err.message : String(err)}); starting a new one`)
      return undefined
    }
  }

  const allocateWorkspace = async (projectCwd: string, runId: string): Promise<{ cwd: string; runId?: string }> => {
    try {
      const worktree = await addWorktree(projectCwd, { runId, branch: runBranchName(runId) })
      // `node_modules` is gitignored, so a fresh worktree has none: link the parent's in, and
      // make git ignore the links (a `node_modules/` rule does not match a symlink, #738).
      await linkDependencies(projectCwd, worktree.path).catch(() => [])
      await excludeDependencyLinks(projectCwd).catch(() => {})
      return { cwd: worktree.path, runId }
    } catch (err) {
      console.log(`[framework] no worktree for ${basename(projectCwd)} (${err instanceof Error ? err.message : String(err)}); running in the main checkout`)
      return { cwd: projectCwd }
    }
  }

  /**
   * Retire a finished run's worktree (#737). Its history lives inside the worktree, so it is
   * copied into the repo first — otherwise removing the checkout would delete the run from the
   * dashboard's history.
   *
   * Then the retention rule: a run that finished cleanly has nothing left to look at once its
   * work is committed, so its worktree goes. A run that failed or was stopped keeps its checkout,
   * because that is exactly when you want to see the half-finished working tree and the diff it
   * died holding. Those are removed explicitly (the dashboard's Remove), never silently on a timer.
   *
   * Best-effort from end to end: this runs off a process-exit event with nothing to return to,
   * so a failure here must not take the daemon down.
   */
  const tearDownWorktree = async (projectCwd: string, worktree: string, runId?: string): Promise<void> => {
    try {
      // A session can be serving its own checkout (#797), and that dev server holds the directory
      // it is about to lose. Stop it first, whether or not the worktree ends up removed: the run
      // is over, so the preview is serving a tree nothing is working on.
      await onStopPreview(projectKeyFor(projectCwd), runId)
      // Where the work ended up, recorded before the checkout can go (#799). The branch outlives
      // the worktree and is the only handle the dashboard has left on a finished session.
      const branch = await currentBranch(worktree)
      const meta = await archiveWorktreeRun(worktree, projectCwd, undefined, branch)
      if (meta?.status !== 'done') return // failed / stopped / unreadable: keep it for inspection
      // A finished run can still be holding an uncommitted edit (#786), and removing the
      // checkout would destroy it. Commit it to the run's branch, which outlives the
      // worktree; if that cannot be done, keep the checkout rather than take the diff with it.
      if (!(await commitPendingWork(worktree))) {
        console.log(`[framework] keeping worktree ${worktree}: its uncommitted work could not be committed`)
        return
      }
      await removeWorktree(projectCwd, worktree)
      await pruneWorktrees(projectCwd)
    } catch {
      // A worktree we could not retire is a worktree left on disk, which is the safe direction.
    }
  }

  // Start-from-dashboard (#345): spawn `framework "<prompt>" --no-dashboard --cwd <checkout>`
  // as a detached child — the same spawn ensureDaemon uses for the daemon itself. The run
  // streams into the page via its tailed event log, and its gates + Stop steer through the
  // control channel (#344).
  //
  // Concurrency is per run, not per project (#736): the #393 one-run-per-project refusal
  // existed because two runs shared one working tree, and worktrees remove that collision.
  // Rom's call on the cap is unbounded ("the best solution for the user unless/until we
  // stumble upon issues"), so the guard now only refuses a duplicate of the *same* checkout —
  // which in practice means the fallback path above.
  const onStart = async (
    prompt: string,
    kind: StartRunKind,
    options: StartRunOptions = {},
    targetProjectId?: string,
  ): Promise<StartRunResult> => {
    const projectKey = targetProjectId ?? homeId
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    let realBin: string
    try {
      realBin = resolveSpawnBin(binPath)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    // Continuing an existing run (#762) reuses its id, checkout and log; anything else is new.
    const continued = options.continueRunId ? await continueWorkspace(projectCwd, options.continueRunId) : undefined
    const workspace = continued ?? (await allocateWorkspace(projectCwd, runIdFromStartedAt(new Date().toISOString())))
    // A run in its own worktree is keyed by that worktree, so it never collides with a
    // sibling; a fallback run is keyed by the project, restoring the one-at-a-time guard.
    const key = workspace.runId ? `${projectKey}::${workspace.runId}` : projectKey
    const active = activeRuns.get(key)
    if (starting.has(key) || (active !== undefined && isProcessAlive(active))) {
      return { ok: false, busy: true, error: 'a session is already active for this project; stop it or wait for it to finish' }
    }
    activeRuns.delete(key)
    starting.add(key)
    try {
      // [Research] (#331) runs the research subcommand; its empty prompt is fine
      // (the "what" defaults to `this PR` in the CLI). A `prompt` kind (#353) is a
      // preset the user reviewed in the textarea: run it verbatim, never re-render.
      const runArgs =
        kind === 'research'
          ? ['research', ...(prompt ? [prompt] : [])]
          : kind === 'prompt'
            ? ['prompt', prompt]
            : [prompt]
      // `--run-id` hands the run the id its worktree is named with, so the directory and the
      // run recorded inside it are one string — and tells it the framework owns its branch.
      const child = spawnDetached(realBin, [
        ...runArgs,
        ...startOptionFlags(options),
        '--no-dashboard',
        '--cwd',
        workspace.cwd,
        ...(workspace.runId ? ['--run-id', workspace.runId] : []),
        // Reopen the run's log instead of truncating it: the follow-up IS that run.
        ...(continued ? ['--continue-run'] : []),
      ])
      // The run narrates itself through its own `.the-framework/events.jsonl`, which the
      // dashboard streams over a Telefunc Channel; the daemon just tracks liveness.
      const settle = (): void => {
        activeRuns.delete(key)
        if (workspace.runId) void tearDownWorktree(projectCwd, workspace.cwd, workspace.runId)
      }
      child.once('error', settle)
      child.once('exit', settle)
      if (child.pid !== undefined) activeRuns.set(key, child.pid)
      // Hand back the run's id (#761) so the dashboard can select this run rather than guess.
      return { ok: true, ...(workspace.runId ? { runId: workspace.runId } : {}) }
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
  //
  // Since #797 the key carries the session too, because a session serves its OWN worktree: one
  // preview per project as before, plus one per session that asks for it, each pointing at the
  // tree it belongs to. Keyed by project alone, a session's Serve booted the project's checkout
  // and showed you code that session never wrote.
  const previewKeyFor = (projectKey: string, runId?: string): string =>
    runId ? `${projectKey}::${runId}` : projectKey
  /** The project half of a preview key from a checkout: the registry id every RPC keys by. */
  const projectKeyFor = (projectCwd: string): string => projectId(resolve(projectCwd))
  const trackPreview = (key: string, handle: PreviewHandle): void => {
    activePreviews.set(key, handle)
    void handle.exited.then(() => {
      if (activePreviews.get(key) === handle) activePreviews.delete(key)
    })
  }
  // The app the user last served per project (#651), so re-serving a monorepo picks it again
  // without re-choosing. In-memory: a live preview already rehydrates via onPreviewStatus, and
  // the pick resets on daemon restart (the picker still lists everything).
  const lastServeTarget = new Map<string, string>()
  const onServeTargets = async (targetProjectId?: string, runId?: string): Promise<ServeTarget[]> => {
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return []
    // Detected in the checkout that will actually be served: a session's branch may have added or
    // removed a servable package, and offering the project's list would offer apps it cannot serve.
    const serveCwd = await resolveRunCheckout(projectCwd, runId)
    return detectServeTargets(serveCwd).catch(() => [])
  }
  const onPreview = async (targetProjectId?: string, targetId?: string, runId?: string): Promise<PreviewResult> => {
    const projectKey = targetProjectId ?? homeId
    const key = previewKeyFor(projectKey, runId)
    const existing = activePreviews.get(key)
    if (existing) return { ok: true, url: existing.url, command: existing.command }
    const projectCwd = await resolveProject(targetProjectId)
    if (!projectCwd) return { ok: false, error: `unknown project: ${targetProjectId}` }
    const serveCwd = await resolveRunCheckout(projectCwd, runId)
    try {
      // Resolve the pick: an explicit choice, else the one remembered from last time. Both are
      // matched against the live target list so a stale/unknown id falls back to the root default.
      // The memory is per project, not per session: which app you serve is a property of the repo.
      const wantId = targetId ?? lastServeTarget.get(projectKey)
      const target = wantId ? (await detectServeTargets(serveCwd).catch(() => [])).find(t => t.id === wantId) : undefined
      const handle = await startPreview(target ? { cwd: serveCwd, target } : { cwd: serveCwd })
      // A racing second open won the slot while we were booting: keep theirs, drop ours.
      const raced = activePreviews.get(key)
      if (raced) {
        await handle.stop().catch(() => {})
        return { ok: true, url: raced.url, command: raced.command }
      }
      if (target) lastServeTarget.set(projectKey, target.id)
      trackPreview(key, handle)
      return { ok: true, url: handle.url, command: handle.command }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const onStopPreview = async (targetProjectId?: string, runId?: string): Promise<void> => {
    const key = previewKeyFor(targetProjectId ?? homeId, runId)
    const handle = activePreviews.get(key)
    if (!handle) return
    activePreviews.delete(key)
    await handle.stop().catch(() => {})
  }
  const onPreviewStatus = (targetProjectId?: string, runId?: string): PreviewStatus => {
    const handle = activePreviews.get(previewKeyFor(targetProjectId ?? homeId, runId))
    return handle ? { running: true, url: handle.url, command: handle.command } : { running: false }
  }

  /**
   * How many runs are live on a project (#685). Run keys are `<projectKey>::<runId>`, or the
   * bare project key for a run that got no worktree, so both spellings count. The pid is
   * re-checked rather than trusted: `settle` clears the entry on exit, but a run whose exit
   * event never arrived would otherwise keep a project looking busy forever.
   */
  const activeRunCount = (targetProjectId: string): number => {
    let live = 0
    for (const [key, pid] of activeRuns) {
      if (key !== targetProjectId && !key.startsWith(`${targetProjectId}::`)) continue
      if (isProcessAlive(pid)) live++
    }
    return live + [...starting].filter(key => key === targetProjectId || key.startsWith(`${targetProjectId}::`)).length
  }

  const dispose = async (): Promise<void> => {
    await Promise.all([...activePreviews.values()].map(p => p.stop().catch(() => {})))
    activePreviews.clear()
  }

  return { onStart, onAddProject, onPreview, onServeTargets, onStopPreview, onPreviewStatus, activeRunCount, dispose }
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
