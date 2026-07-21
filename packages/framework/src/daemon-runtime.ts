import { spawn, type ChildProcess } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import {
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
  resolveRunCheckout,
  isPidAlive,
  writeSuspendedRuns,
  type SuspendedRun,
} from './store/index.js'
import type { StartRunKind, StartRunOptions, StartRunResult, AddProjectResult, PreviewResult, PreviewStatus } from './dashboard/index.js'
import type { PreviewHandlers } from './dashboard/telefunc-serve.js'
import { isSafeVia } from './conversations.js'
import { startPreview, detectServeTargets, type PreviewHandle, type ServeTarget } from './preview.js'
import { addProject, listProjects, projectId } from './registry.js'
import { installProject, enumerateGitRepos } from './install.js'
import { errorMessage } from './error-message.js'

/**
 * The daemon's per-project business logic (#393/#736): spawning runs into worktrees, installing
 * projects, and app previews, plus the spawn/terminate plumbing those need. Split from daemon.ts
 * so that file reads as the daemon's lifecycle (state file, ports, boot, shutdown) and this reads
 * as what the daemon does for a project -- the split createProjectRuntime's own doc always
 * claimed, finished.
 */

/**
 * One composite key scheme for the runtime's per-run state: `<projectKey>::<runId>`, or the bare
 * project key for a project-scoped entry (a fallback run with no worktree, a project's preview).
 * Built and parsed only here -- three call sites used to hand-roll the encoding, the prefix
 * match and the split separately.
 */
const scopedKey = (projectKey: string, runId?: string): string => (runId ? `${projectKey}::${runId}` : projectKey)

/** The two halves of a {@link scopedKey}. */
function parseScopedKey(key: string): { projectKey: string; runId?: string } {
  const separator = key.indexOf('::')
  return separator === -1 ? { projectKey: key } : { projectKey: key.slice(0, separator), runId: key.slice(separator + 2) }
}

/** Whether a {@link scopedKey} belongs to a project (its own entry, or one of its runs). */
const keyBelongsTo = (key: string, projectKey: string): boolean => key === projectKey || key.startsWith(`${projectKey}::`)

/**
 * Locate the CLI entry to re-invoke for a detached child, refusing to re-exec a test
 * file. Under `node --test` (or a direct `node foo.test.js`) `process.argv[1]` is the test
 * file, which re-runs the whole suite instead of the daemon/run body — and that suite calls
 * back here, so each spawn spawns another: a fork bomb. A real run passes the compiled bin
 * (or an explicit `binPath`), so the guard only ever trips in tests.
 */
export function resolveSpawnBin(explicitBinPath: string | undefined): string {
  const binPath = explicitBinPath ?? process.argv[1]
  if (!binPath) throw new Error('cannot locate the framework CLI entry')
  if (!explicitBinPath && (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(binPath))) {
    throw new Error('refusing to spawn a framework process from a test entry; pass an explicit binPath')
  }
  return binPath
}

/** Spawn a detached, unref'd framework child (`node <binPath> <args...>`) that outlives us. */
export function spawnDetached(binPath: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, [binPath, ...args], { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

/**
 * Translate the dashboard's Global options (#314) into CLI flags for the spawned
 * run. Only enabled toggles emit a flag, so a default (all-off) start is
 * byte-identical to before. `parseArgs` on the other side accepts every one.
 */
export function startOptionFlags(options: StartRunOptions): string[] {
  const flags: string[] = []
  // The four toggles the repo's the-framework.yml also owns are tri-state (#842): an explicit
  // `false` emits the `--no-*` form (#841) so a start from the launcher can turn off what the
  // repo file turned on. Absent still emits nothing, leaving the file to decide.
  for (const [key, flag] of [
    ['autopilot', '--autopilot'],
    ['technical', '--technical'],
    ['vanilla', '--vanilla'],
    ['transparent', '--transparent'],
  ] as const) {
    const value = options[key]
    if (value === true) flags.push(flag)
    else if (value === false) flags.push(`--no-${flag.slice(2)}`)
  }
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
  // The originating surface (#917): only a safe transport name is forwarded, since it reaches the
  // conversation heading, which is line-parsed.
  if (isSafeVia(options.via)) flags.push('--via', options.via)
  // Resume a finished run's session (#720): the spawned run continues that conversation.
  if (typeof options.resumeSession === 'string' && options.resumeSession.trim()) {
    flags.push('--resume-session', options.resumeSession.trim())
  }
  return flags
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

/**
 * Stop a process and wait for it to actually go: SIGTERM, then SIGKILL if the grace period lapses.
 * Returns whether it was alive to begin with.
 *
 * Both callers need the escalation for the same reason and had their own copy of it: a process
 * that ignores SIGTERM (or wedges in shutdown) must not be left holding a port or a worktree.
 */
export async function terminate(pid: number, graceMs: number): Promise<boolean> {
  if (!isPidAlive(pid)) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // exited between the check and the signal
  }
  if (!(await waitForExit(pid, graceMs))) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // raced us to exit
    }
    await waitForExit(pid, 1000)
  }
  return true
}

/** Poll until the process is gone, or the timeout lapses. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const step = 50
  for (let waited = 0; waited <= timeoutMs; waited += step) {
    if (!isPidAlive(pid)) return true
    await delay(step)
  }
  return !isPidAlive(pid)
}

/** Inputs to {@link createProjectRuntime}. */
export interface ProjectRuntimeOptions {
  /** The daemon's home workspace; a run/preview with no project id targets it. */
  cwd: string
  /** Env for the registry lookups (#393). */
  env: NodeJS.ProcessEnv
  /** The CLI entry to spawn runs with (#345); undefined uses `process.argv[1]`. */
  binPath?: string | undefined
}

/** The per-project run + preview surface the dashboard drives, plus its teardown. */
export interface ProjectRuntime {
  onStart: (prompt: string, kind: StartRunKind, options?: StartRunOptions, targetProjectId?: string) => Promise<StartRunResult>
  onAddProject: (path: string, directory: boolean) => Promise<AddProjectResult>
  /** The Preview handler set (#475/#797), handed to the dashboard as one value so `runId` survives. */
  preview: PreviewHandlers
  /** Live runs on a project (#685), so a background job can tell an idle project from a busy one. */
  activeRunCount: (targetProjectId: string) => number
  /**
   * Stop the runs this daemon spawned and record each as resumable (#923). Returns how many
   * were suspended. Called on shutdown, before the previews go.
   */
  suspendRuns: (graceMs?: number) => Promise<number>
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
export function createProjectRuntime({ cwd, env, binPath }: ProjectRuntimeOptions): ProjectRuntime {
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
      console.log(`[framework] could not continue session ${runId} (${errorMessage(err)}); starting a new one`)
      return undefined
    }
  }

  /**
   * The checkout a run gets (#736). Each run is given its own git worktree under the project's
   * `.the-framework/worktrees/<runId>`, on a `the-framework/run-<runId>` branch, so N runs on one
   * repo never fight over the working tree — and the user's own checkout, uncommitted work
   * included, is left untouched.
   *
   * A project that cannot provide one (not a git repo, or any git failure) falls back to the main
   * checkout, which is exactly the pre-#736 behavior — and keeps its pre-#736 limit of one run at a
   * time, since those runs *would* collide. Signalled by the absent `runId`.
   */
  const allocateWorkspace = async (projectCwd: string, runId: string): Promise<{ cwd: string; runId?: string }> => {
    try {
      const worktree = await addWorktree(projectCwd, { runId, branch: runBranchName(runId) })
      // `node_modules` is gitignored, so a fresh worktree has none: link the parent's in, and
      // make git ignore the links (a `node_modules/` rule does not match a symlink, #738).
      await linkDependencies(projectCwd, worktree.path).catch(() => [])
      await excludeDependencyLinks(projectCwd).catch(() => {})
      return { cwd: worktree.path, runId }
    } catch (err) {
      console.log(`[framework] no worktree for ${basename(projectCwd)} (${errorMessage(err)}); running in the main checkout`)
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
      return { ok: false, error: errorMessage(err) }
    }

    // Continuing an existing run (#762) reuses its id, checkout and log; anything else is new.
    const continued = options.continueRunId ? await continueWorkspace(projectCwd, options.continueRunId) : undefined
    const workspace = continued ?? (await allocateWorkspace(projectCwd, runIdFromStartedAt(new Date().toISOString())))
    // A run in its own worktree is keyed by that worktree, so it never collides with a
    // sibling; a fallback run is keyed by the project, restoring the one-at-a-time guard.
    const key = scopedKey(projectKey, workspace.runId)
    const active = activeRuns.get(key)
    if (starting.has(key) || (active !== undefined && isPidAlive(active))) {
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
    const key = scopedKey(projectKey, runId)
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
      return { ok: false, error: errorMessage(err) }
    }
  }
  const onStopPreview = async (targetProjectId?: string, runId?: string): Promise<void> => {
    const key = scopedKey(targetProjectId ?? homeId, runId)
    const handle = activePreviews.get(key)
    if (!handle) return
    activePreviews.delete(key)
    await handle.stop().catch(() => {})
  }
  const onPreviewStatus = (targetProjectId?: string, runId?: string): PreviewStatus => {
    const handle = activePreviews.get(scopedKey(targetProjectId ?? homeId, runId))
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
      if (!keyBelongsTo(key, targetProjectId)) continue
      if (isPidAlive(pid)) live++
    }
    return live + [...starting].filter(key => keyBelongsTo(key, targetProjectId)).length
  }

  /**
   * Stop the runs this daemon spawned, and record them as resumable (#923).
   *
   * A spawned run is detached so it survives the CLI that asked for it, not so it survives the
   * daemon that owns it: left alone it becomes an orphan on `ppid 1`, holding a worktree and a
   * headless browser, with no daemon left that knows about it. So each gets a SIGTERM, which the
   * run already handles by aborting cleanly and group-killing its agent, and a SIGKILL if it will
   * not go. Only runs in `activeRuns` — a run this daemon merely steers (#393) is not its to stop.
   *
   * What is stopped here is not lost: the run keeps its worktree and branch (a run that ends
   * `stopped` is retained, see tearDownWorktree), and its id + agent session are written to the
   * project so the next daemon can continue the same conversation in the same checkout. A run that
   * managed to finish while we were asking is left out — there is nothing to resume.
   */
  const suspendRuns = async (graceMs = 5000): Promise<number> => {
    const byProject = new Map<string, SuspendedRun[]>()
    const stopping = [...activeRuns.entries()]
    activeRuns.clear()
    for (const [key, pid] of stopping) {
      const { projectKey, runId } = parseScopedKey(key)
      const projectCwd = await resolveProject(projectKey)
      if (!(await terminate(pid, graceMs))) continue
      // A fallback run (no worktree, no run id) cannot be continued, so it is stopped and no more.
      if (!runId || !projectCwd) continue
      const meta = (await readLiveMetas(projectCwd).catch(() => [])).find(run => run.id === runId)
      if (meta?.status === 'done') continue
      const entry: SuspendedRun = {
        runId,
        suspendedAt: new Date().toISOString(),
        ...(meta?.sessionId ? { sessionId: meta.sessionId } : {}),
      }
      byProject.set(projectCwd, [...(byProject.get(projectCwd) ?? []), entry])
    }
    let suspended = 0
    for (const [projectCwd, runs] of byProject) {
      await writeSuspendedRuns(projectCwd, runs).catch(() => {})
      suspended += runs.length
    }
    return suspended
  }

  const dispose = async (): Promise<void> => {
    await Promise.all([...activePreviews.values()].map(p => p.stop().catch(() => {})))
    activePreviews.clear()
  }

  return {
    onStart,
    onAddProject,
    preview: { start: onPreview, targets: onServeTargets, stop: onStopPreview, status: onPreviewStatus },
    activeRunCount,
    suspendRuns,
    dispose,
  }
}
