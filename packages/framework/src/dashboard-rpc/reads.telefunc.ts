import { findRun, readLiveMetas, readAllRuns, loadRunEvents, worktreeSize, isSafeRunId, type RunMeta } from '../store/index.js'
import { listProjectWorktrees } from '../worktrees.js'
import { readLogs, type LogEntry } from '../logs.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { readTickets, type WorkspaceTicket } from '../dashboard/tickets.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, type Overview } from '../dashboard/overview.js'
import { buildInterventions, type Intervention } from '../dashboard/interventions.js'
import { buildActivity, type Activity } from '../dashboard/activity.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { githubUrlFor } from '../dashboard/github.js'
import { readGitStatus, type GitStatus } from '../dashboard/git-status.js'
import { readRunHandoff, runBranchFor, type RunHandoff } from '../dashboard/run-handoff.js'
import type { RunWorktree } from '../dashboard/types.js'
import { crawlRepoFiles } from '../project.js'
import { readFileStatuses, type FileGitStatus } from '../dashboard/file-status.js'
import { readFileDiff, readFileChanges, type FileDiff, type FileChange } from '../dashboard/file-diff.js'
import { readFileContent, type FileContent } from '../dashboard/file-read.js'
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
  return readAllRuns(cwd)
}

/**
 * The run ids that still have a worktree on disk (#737). A run that failed or was stopped keeps
 * its checkout so you can go look at what it was holding; this is how the dashboard knows which
 * finished run has one to offer removing. Live runs are excluded — their worktree is in use.
 */
export async function onRetainedWorktrees(projectId: string): Promise<string[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  // The CLI's `framework worktrees` builds the same view; one list, two surfaces (#752).
  const rows = await listProjectWorktrees(cwd, { sizes: false }).catch((): never[] => [])
  return rows.filter(row => !row.live).map(row => row.runId)
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

/** The project's `tickets/*.md`, by filename (#697). `[]` when the repo has no `tickets/` yet. */
export async function onTickets(projectId: string): Promise<WorkspaceTicket[]> {
  return withProject(projectId, readTickets, [])
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

/**
 * One changed file's diff, for the tree's hover card (#816). Null when the path is not a changed
 * file, is unsafe (see `safeRepoPath`), or there is no checkout. Reads the run's own worktree when
 * `runId` names one, so it shows the same change the tree dotted (#815).
 *
 * The status comes from the same `git status` the dots do, rather than from the caller: a client
 * that thinks a file is untracked must not be able to make the server read it as one.
 */
export async function onFileDiff(projectId: string, path: string, runId?: string): Promise<FileDiff | null> {
  const cwd = await resolveRunPath(projectId, runId)
  if (!cwd) return null
  const statuses = await readFileStatuses(cwd).catch((): Record<string, FileGitStatus> => ({}))
  const status = statuses[path]
  if (!status) return null
  return readFileDiff(cwd, path, status).catch(() => null)
}

/**
 * What the session changed (#817): every changed file in its worktree with line counts, newest
 * state each poll. `[]` when nothing changed or there is no checkout.
 *
 * Derived from the worktree rather than from the agent's tool calls on purpose. The driver
 * surfaces a tool's name and not its arguments (#165) — we verify by outcome, not by watching
 * which tool the agent reached for — so reading git is both the honest source and the one that
 * works for every agent, not just the ones whose stream carries an edit payload.
 */
export async function onRunChanges(projectId: string, runId?: string): Promise<FileChange[]> {
  const cwd = await resolveRunPath(projectId, runId)
  if (!cwd) return []
  const statuses = await readFileStatuses(cwd).catch((): Record<string, FileGitStatus> => ({}))
  return readFileChanges(cwd, statuses).catch(() => [])
}

/**
 * One unchanged file's contents, for the tree's hover card (#828). Null when the path is unsafe
 * (see `safeRepoPath`), outside the checkout, or unreadable. Reads the run's own worktree when
 * `runId` names one, so it shows the copy the tree is listing (#815).
 *
 * The caller picks this or {@link onFileDiff} from the status the tree already holds; a changed
 * file has a diff worth seeing, an unchanged one has only itself.
 */
export async function onFileContent(projectId: string, path: string, runId?: string): Promise<FileContent | null> {
  const cwd = await resolveRunPath(projectId, runId)
  if (!cwd) return null
  return readFileContent(cwd, path).catch(() => null)
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

/**
 * The end-of-session handoff (#799): the branch a finished session left its work on, what it
 * committed, what it changed, and whether that has been pushed or opened as a PR.
 *
 * Read from the *project* checkout against the session's branch, not from the session's worktree.
 * A clean run's worktree is removed when it finishes, and `resolveRunPath` then falls back to the
 * project root — so a worktree-addressed read reports the project's own branch and the user's own
 * uncommitted changes as though they were the session's. The branch is what outlives the run, so
 * the branch is what this asks about.
 */
export async function onRunHandoff(projectId: string, runId: string): Promise<RunHandoff | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isSafeRunId(runId)) return null
  const run = await findRun(cwd, runId).catch(() => undefined)
  if (!run) return null
  return (await readRunHandoff(cwd, runBranchFor(run)).catch(() => undefined)) ?? null
}
