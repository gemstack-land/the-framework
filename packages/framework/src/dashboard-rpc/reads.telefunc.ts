import { listRuns, readLiveMetas, loadRunEvents, listWorktreeDirs, worktreeSize, isSafeRunId, type RunMeta } from '../store/index.js'
import { readLogs, type LogEntry } from '../logs.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, type Overview } from '../dashboard/overview.js'
import { buildInterventions, type Intervention } from '../dashboard/interventions.js'
import { buildActivity, type Activity } from '../dashboard/activity.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { githubUrlFor } from '../dashboard/github.js'
import { readGitStatus, type GitStatus } from '../dashboard/git-status.js'
import type { RunWorktree } from '../dashboard/types.js'
import { crawlRepoFiles } from '../project.js'
import { readFileStatuses, type FileGitStatus } from '../dashboard/file-status.js'
import { contextProjects, resolveProjectPath, resolveRunPath } from './context.js'
import type { FrameworkEvent } from '../events.js'

// The read model behind the new dashboard (#405): the run history, a run's replay, the
// surfaced PLAN/TODO docs, and the committed LOGS.md — each keyed by project id and
// backed by the same readers the daemon's legacy /api/* endpoints use, so the dashboard
// stays a projection of the same files. These implementations live in @gemstack/framework
// so the daemon can serve them in-process (the client imports them via re-export shims
// in framework-dashboard, keeping the baked RPC keys `/server/reads.telefunc.ts`). The
// live run stream is its own Telefunc Channel (events.telefunc.ts).

/**
 * Resolve a project id and run a forgiving read against its workspace: an unknown project
 * or a failing read both fall back to `empty`. The uniform readers below are one call each
 * over this; the run history and null-returning git readers stay bespoke (extra logic or a
 * distinct empty).
 */
async function withProject<T>(projectId: string, read: (cwd: string) => Promise<T>, empty: T): Promise<T> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? read(cwd).catch(() => empty) : empty
}

/**
 * The project's runs, most-recent first (or `[]`). The archived (finished) runs
 * from `runs/`, plus every live run prepended — so the sidebar shows an in-progress
 * run with a `running` status the moment it starts, not only after it closes.
 *
 * Since #736 a project has any number of live runs, each in its own worktree, so this reads
 * them all (#738) instead of the single one that used to sit at the project path. They come
 * back as {@link LiveRun}s, carrying the `cwd` of the checkout that run is editing.
 *
 * One row per id, and where both a live and an archived copy exist the live one wins (#768): a
 * continued run (#762) has an archive from its first leg while being live again, and the archive
 * would otherwise show a running run as finished. The status is not filtered on: `readLiveMeta`
 * may have just self-healed a dead run to `stopped` (#716), and that freshly-archived row can
 * lag `listRuns` by a poll — keeping it regardless leaves the row visible with no flicker.
 */
export async function onRuns(projectId: string): Promise<RunMeta[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  const archived = await listRuns(cwd).catch(() => [])
  const live = await readLiveMetas(cwd).catch(() => [])
  // Live wins over archived (#768). The dedup used to drop the live copy, which was right while
  // "archived" meant "finished for good": a run was only ever copied into `runs/` on its way out.
  // Continuing a run (#762) breaks that — the run has an archived copy from its first leg AND is
  // live again — and keeping the archive showed a running run as finished.
  return [...live, ...archived.filter(run => !live.some(l => l.id === run.id))]
}

/**
 * The run ids that still have a worktree on disk (#737). A run that failed or was stopped keeps
 * its checkout so you can go look at what it was holding; this is how the dashboard knows which
 * finished run has one to offer removing. Live runs are excluded — their worktree is in use.
 */
export async function onRetainedWorktrees(projectId: string): Promise<string[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  const [names, live] = await Promise.all([
    listWorktreeDirs(cwd).catch(() => []),
    readLiveMetas(cwd).catch(() => []),
  ])
  const running = new Set(live.filter(run => run.status === 'running').map(run => run.id))
  return names.filter(id => !running.has(id)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

/**
 * Where a session is working (#798): the checkout it has, its branch, whether it is holding
 * uncommitted changes, and — once it is no longer live — what that checkout costs on disk.
 *
 * The dashboard could not answer "where is this session working". The git status bar reads the
 * *project*, so a session's own branch was visible nowhere, and a worktree a run kept (#737) was
 * a name in a list with no size and no way in.
 *
 * `own` separates a run with its own worktree from one that fell back to the main checkout (a
 * project with no git repo): "uncommitted changes" means something different there, since that
 * working tree is the user's, not the agent's.
 */
export async function onRunWorktree(projectId: string, runId: string): Promise<RunWorktree | null> {
  const root = await resolveProjectPath(projectId)
  if (!root || !isSafeRunId(runId)) return null
  const path = await resolveRunPath(projectId, runId)
  if (!path) return null
  const own = path !== root
  const [status, live] = await Promise.all([
    readGitStatus(path).catch(() => undefined),
    readLiveMetas(root).catch(() => []),
  ])
  // Size is only read for a checkout nothing is writing to: a live run's tree changes under the
  // poll, and `du` over a build directory mid-build is a cost with no answer worth having.
  const running = live.some(run => run.id === runId && run.status === 'running')
  const size = own && !running ? await worktreeSize(path) : undefined
  return {
    path,
    own,
    dirty: status?.dirty ?? false,
    ...(status?.branch ? { branch: status.branch } : {}),
    ...(size !== undefined ? { sizeBytes: size } : {}),
    // The same read already looked the PR up (#809): a session's branch is exactly the thing
    // that has one, so the session's bar can show it like the project's does.
    ...(status?.pr ? { pr: status.pr } : {}),
  }
}

/** One archived run's event log for replay (or `[]` when the run or project is gone). */
export async function onRun(projectId: string, runId: string): Promise<FrameworkEvent[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  return (await loadRunEvents(cwd, runId).catch(() => undefined)) ?? []
}

/** The surfaced PLAN/TODO docs at the workspace root, in sidebar order (or `[]`). */
export async function onDocs(projectId: string): Promise<WorkspaceDoc[]> {
  return withProject(projectId, readDocs, [])
}

/** The committed `.the-framework/LOGS.md` entries, newest-first (or `[]`). */
export async function onProjectLog(projectId: string): Promise<LogEntry[]> {
  return withProject(projectId, readLogs, [])
}

/** The aggregated open TODO queue across every registered project (#438), most-open first. */
export async function onQueue(): Promise<ProjectQueue[]> {
  const projects = await contextProjects().list().catch(() => [])
  return collectQueue(projects)
}

/** The cross-project Overview (#437): what is running now, the queue size, and recent projects. */
export async function onOverview(): Promise<Overview> {
  const projects = await contextProjects().list().catch(() => [])
  return buildOverview(projects)
}

/** The cross-project interventions queue (#632, Queue #624): open PRs that need review, newest first. */
export async function onInterventions(): Promise<Intervention[]> {
  const projects = await contextProjects().list().catch(() => [])
  return buildInterventions(projects)
}

/** The cross-project "New activity" feed (#627): recent run started/finished transitions, newest first. */
export async function onActivity(): Promise<Activity[]> {
  const projects = await contextProjects().list().catch(() => [])
  return buildActivity(projects)
}

/** The Overview dashboard page (#471): the {@link onOverview} rollup plus run counts, run-status totals, and activity. */
export async function onDashboard(): Promise<DashboardData> {
  const projects = await contextProjects().list().catch(() => [])
  return buildDashboard(projects)
}

/**
 * The project's files for the `#` context picker (#504) and the panel tree (#492): every
 * file git sees (tracked + untracked, honoring .gitignore), repo-relative and sorted, via
 * `git ls-files`. Localhost-only by nature — the relay has no checkout, so it resolves `[]`.
 * Pass a live `runId` to list that run's worktree instead of the project root (#738).
 */
export async function onProjectFiles(projectId: string, runId?: string): Promise<string[]> {
  const cwd = await resolveRunPath(projectId, runId)
  return cwd ? crawlRepoFiles(cwd).catch(() => []) : []
}

/**
 * Per-file git status for the tree's dots (#492): repo-relative path -> untracked/modified/
 * deleted, from `git status --porcelain`. `{}` when not a repo / on the relay (no checkout).
 * Pass a live `runId` to see that run's own worktree rather than the project root (#738).
 */
export async function onProjectFileStatus(projectId: string, runId?: string): Promise<Record<string, FileGitStatus>> {
  const cwd = await resolveRunPath(projectId, runId)
  return cwd ? readFileStatuses(cwd).catch(() => ({})) : {}
}

/** The project's GitHub URL from its `origin` remote (#489), or null (no remote / not GitHub / relay). */
export async function onGithubUrl(projectId: string): Promise<string | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return (await githubUrlFor(cwd)) ?? null
}

/**
 * The project's git status (#491): active branch, dirty flag, linked PR. Null when not a repo /
 * relay. Pass a live `runId` to read that run's worktree, which is the branch and the dirty
 * state that actually belong to it (#738).
 */
export async function onGitStatus(projectId: string, runId?: string): Promise<GitStatus | null> {
  const cwd = await resolveRunPath(projectId, runId)
  if (!cwd) return null
  return (await readGitStatus(cwd)) ?? null
}
