import {
  defaultProjectsProvider,
  listRuns,
  loadRunEvents,
  readLogs,
  readDocs,
  type RunMeta,
  type LogEntry,
  type WorkspaceDoc,
  type FrameworkEvent,
} from '@gemstack/framework'

// The read model over Telefunc (#405 phase 2): the run history, a run's replay, the
// surfaced PLAN/TODO docs, and the committed LOGS.md — each keyed by project id and
// backed by the same readers the daemon's /api/* endpoints use, so the new dashboard
// stays a projection of the same files. The live run stream is its own Telefunc
// Channel (events.telefunc.ts).

/** The registry path for a project id, or undefined when unknown (readers then yield empty). */
async function projectPath(projectId: string): Promise<string | undefined> {
  return defaultProjectsProvider().resolvePath(projectId)
}

/** The project's archived runs, most-recent first (or `[]`). */
export async function onRuns(projectId: string): Promise<RunMeta[]> {
  const cwd = await projectPath(projectId)
  return cwd ? listRuns(cwd).catch(() => []) : []
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
