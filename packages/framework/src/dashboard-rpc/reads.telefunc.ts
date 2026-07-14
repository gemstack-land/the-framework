import { listRuns, readLiveMeta, loadRunEvents, type RunMeta } from '../store/index.js'
import { readLogs, type LogEntry } from '../logs.js'
import { readDocs, type WorkspaceDoc } from '../dashboard/docs.js'
import { collectQueue, type ProjectQueue } from '../dashboard/queue.js'
import { buildOverview, type Overview } from '../dashboard/overview.js'
import { buildDashboard, type DashboardData } from '../dashboard/dashboard.js'
import { contextProjects } from './context.js'
import type { FrameworkEvent } from '../events.js'

// The read model behind the new dashboard (#405): the run history, a run's replay, the
// surfaced PLAN/TODO docs, and the committed LOGS.md — each keyed by project id and
// backed by the same readers the daemon's legacy /api/* endpoints use, so the dashboard
// stays a projection of the same files. These implementations live in @gemstack/framework
// so the daemon can serve them in-process (the client imports them via re-export shims
// in framework-dashboard, keeping the baked RPC keys `/server/reads.telefunc.ts`). The
// live run stream is its own Telefunc Channel (events.telefunc.ts).

/** The path for a project id (registry, or single-project #427), else undefined -> empty. */
async function projectPath(projectId: string): Promise<string | undefined> {
  return contextProjects().resolvePath(projectId)
}

/**
 * The project's runs, most-recent first (or `[]`). The archived (finished) runs
 * from `runs/`, plus the live run prepended when one is going — so the sidebar
 * shows the in-progress run with a `running` status the moment it starts, not
 * only after it closes. The live run is skipped once it has been archived under
 * the same id (it then appears from `listRuns` instead), so there is no double.
 */
export async function onRuns(projectId: string): Promise<RunMeta[]> {
  const cwd = await projectPath(projectId)
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
  const cwd = await projectPath(projectId)
  if (!cwd) return []
  return (await loadRunEvents(cwd, runId).catch(() => undefined)) ?? []
}

/** The surfaced PLAN/TODO docs at the workspace root, in sidebar order (or `[]`). */
export async function onDocs(projectId: string): Promise<WorkspaceDoc[]> {
  const cwd = await projectPath(projectId)
  return cwd ? readDocs(cwd).catch(() => []) : []
}

/** The committed `.the-framework/LOGS.md` entries, newest-first (or `[]`). */
export async function onProjectLog(projectId: string): Promise<LogEntry[]> {
  const cwd = await projectPath(projectId)
  return cwd ? readLogs(cwd).catch(() => []) : []
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

/** The Overview dashboard page (#471): the {@link onOverview} rollup plus run counts, run-status totals, and activity. */
export async function onDashboard(): Promise<DashboardData> {
  const projects = await contextProjects().list().catch(() => [])
  return buildDashboard(projects)
}
