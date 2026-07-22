import { spawn, type ChildProcess } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { rm, stat } from 'node:fs/promises'
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
  isPidAlive,
  writeSuspendedRuns,
  type SuspendedRun,
} from './store/index.js'
import type { StartRunKind, StartRunOptions, StartRunResult, AddProjectResult } from './dashboard/index.js'
import type { PreviewHandlers } from './dashboard/telefunc-serve.js'
import { isSafeVia } from './conversations.js'
import { createPreviewRuntime } from './preview-runtime.js'
import { scopedKey, parseScopedKey, keyBelongsTo } from './runtime-keys.js'
import { addProject, listProjects, projectId } from './registry.js'
import { installProject, enumerateGitRepos } from './install.js'
import { isGitRepo } from './project.js'
import { isCliTimeout } from './cli-exec.js'
import { errorMessage } from './error-message.js'

/**
 * The daemon's per-project business logic (#393/#736): spawning runs into worktrees, installing
 * projects, and app previews, plus the spawn/terminate plumbing those need. Split from daemon.ts
 * so that file reads as the daemon's lifecycle (state file, ports, boot, shutdown) and this reads
 * as what the daemon does for a project -- the split createProjectRuntime's own doc always
 * claimed, finished.
 */

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

/**
 * Clean up after a `git worktree add` that was SIGTERMed mid-write (#997). Observed behavior: git
 * removes its own administrative entry on the way out but leaves the partial checkout it had
 * already written, so `git worktree prune` finds nothing to do and the directory stays.
 *
 * Only a timeout kill is cleaned up. Any other rejection may be git refusing a path that was
 * already on disk before this run asked for it, and that is not ours to delete.
 */
export async function cleanupTimedOutWorktree(repo: string, runId: string, err: unknown): Promise<void> {
  if (!isCliTimeout(err)) return
  await rm(worktreePath(repo, runId), { recursive: true, force: true }).catch(() => {})
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

  // A project id resolves to its repo path via the registry; the home id (or none)
  // resolves to the daemon's own `cwd` without a lookup.
  const resolveProject = async (id: string | undefined): Promise<string | undefined> => {
    if (!id || id === homeId) return cwd
    const records = await listProjects(undefined, env).catch(() => [])
    return records.find(record => record.id === id)?.path
  }

  // App previews (#475/#797) are their own runtime: they share only this resolver and the key scheme,
  // and the run half reaches in exactly once, to stop a finished run's preview (see tearDownWorktree).
  const previews = createPreviewRuntime({ homeId, resolveProject })

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
   * A project that *structurally* cannot provide one — it is not a git repo — falls back to the
   * main checkout, which is exactly the pre-#736 behavior, and keeps its pre-#736 limit of one run
   * at a time, since those runs *would* collide. Signalled by the absent `runId`.
   *
   * A project that *is* a repo and whose `worktree add` failed does not fall back (#997): that
   * downgrade silently pointed the agent at the user's own working tree, uncommitted work
   * included, which is the one thing #736 exists to prevent. A `worktree add` on a large repo can
   * outrun its budget and be SIGTERMed, so this is reachable in normal use, not just on a broken
   * repo. The run fails instead, because a failed run is recoverable by starting it again and a
   * checkout with agent edits mixed into it is not.
   */
  const allocateWorkspace = async (
    projectCwd: string,
    runId: string,
  ): Promise<{ ok: true; workspace: { cwd: string; runId?: string } } | { ok: false; error: string }> => {
    try {
      const worktree = await addWorktree(projectCwd, { runId, branch: runBranchName(runId) })
      // `node_modules` is gitignored, so a fresh worktree has none: link the parent's in, and
      // make git ignore the links (a `node_modules/` rule does not match a symlink, #738).
      await linkDependencies(projectCwd, worktree.path).catch(() => [])
      await excludeDependencyLinks(projectCwd).catch(() => {})
      return { ok: true, workspace: { cwd: worktree.path, runId } }
    } catch (err) {
      if (await isGitRepo(projectCwd)) {
        await cleanupTimedOutWorktree(projectCwd, runId, err)
        return { ok: false, error: `could not create a worktree for this run: ${errorMessage(err)}` }
      }
      console.log(`[framework] ${basename(projectCwd)} is not a git repository, so it gets no worktree; running in the main checkout`)
      return { ok: true, workspace: { cwd: projectCwd } }
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
  /** The project half of a preview key from a checkout: the registry id every preview RPC keys by. */
  const projectKeyFor = (projectCwd: string): string => projectId(resolve(projectCwd))
  const tearDownWorktree = async (projectCwd: string, worktree: string, runId?: string): Promise<void> => {
    try {
      // A session can be serving its own checkout (#797), and that dev server holds the directory
      // it is about to lose. Stop it first, whether or not the worktree ends up removed: the run
      // is over, so the preview is serving a tree nothing is working on.
      await previews.preview.stop(projectKeyFor(projectCwd), runId)
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
    // A repo that could not be given a worktree fails the Start rather than borrowing the user's
    // own checkout (#997); the dashboard shows the reason, and starting again is the retry.
    const allocated = continued
      ? ({ ok: true, workspace: continued } as const)
      : await allocateWorkspace(projectCwd, runIdFromStartedAt(new Date().toISOString()))
    if (!allocated.ok) return { ok: false, error: allocated.error }
    const workspace = allocated.workspace
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

  return {
    onStart,
    onAddProject,
    preview: previews.preview,
    activeRunCount,
    suspendRuns,
    dispose: previews.dispose,
  }
}
