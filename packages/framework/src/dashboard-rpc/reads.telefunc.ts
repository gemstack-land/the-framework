import { listRuns, readLiveMeta, loadRunEvents, type RunMeta } from '../store/index.js'
import { readLogs, type LogEntry } from '../logs.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, type Overview } from '../dashboard/overview.js'
import { buildInterventions, type Intervention } from '../dashboard/interventions.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { githubUrlFor } from '../dashboard/github.js'
import { readGitStatus, type GitStatus } from '../dashboard/git-status.js'
import { crawlRepoFiles } from '../project.js'
import { readFileStatuses, type FileGitStatus } from '../dashboard/file-status.js'
import { contextProjects, resolveProjectPath } from './context.js'
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
 * from `runs/`, plus the live run prepended when one is going — so the sidebar
 * shows the in-progress run with a `running` status the moment it starts, not
 * only after it closes. The live run is skipped once it has been archived under
 * the same id (it then appears from `listRuns` instead), so there is no double.
 */
export async function onRuns(projectId: string): Promise<RunMeta[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  const archived = await listRuns(cwd).catch(() => [])
  const live = await readLiveMeta(cwd).catch(() => undefined)
  if (live && live.status === 'running' && !archived.some(r => r.id === live.id)) {
    return [live, ...archived]
  }
  return archived
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

/** The Overview dashboard page (#471): the {@link onOverview} rollup plus run counts, run-status totals, and activity. */
export async function onDashboard(): Promise<DashboardData> {
  const projects = await contextProjects().list().catch(() => [])
  return buildDashboard(projects)
}

/**
 * The project's files for the `#` context picker (#504) and the panel tree (#492): every
 * file git sees (tracked + untracked, honoring .gitignore), repo-relative and sorted, via
 * `git ls-files`. Localhost-only by nature — the relay has no checkout, so it resolves `[]`.
 */
export async function onProjectFiles(projectId: string): Promise<string[]> {
  return withProject(projectId, crawlRepoFiles, [])
}

/**
 * Per-file git status for the tree's dots (#492): repo-relative path -> untracked/modified/
 * deleted, from `git status --porcelain`. `{}` when not a repo / on the relay (no checkout).
 */
export async function onProjectFileStatus(projectId: string): Promise<Record<string, FileGitStatus>> {
  return withProject(projectId, readFileStatuses, {})
}

/** The project's GitHub URL from its `origin` remote (#489), or null (no remote / not GitHub / relay). */
export async function onGithubUrl(projectId: string): Promise<string | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return (await githubUrlFor(cwd)) ?? null
}

/** The project's git status (#491): active branch, dirty flag, linked PR. Null when not a repo / relay. */
export async function onGitStatus(projectId: string): Promise<GitStatus | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return (await readGitStatus(cwd)) ?? null
}
