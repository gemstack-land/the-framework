import { basename } from 'node:path'
import { listProjects, type ProjectRecord } from '../registry.js'
import { isActivated } from '../project.js'
import { readLogs, type LogEntry } from '../logs.js'

/**
 * The multi-project read side (#392): projects the daemon serves come from the
 * registry (#390), and each read endpoint (`/api/logs`, `/api/runs`, `/api/docs`)
 * resolves a `?project=<id>` to that project's path before running the existing
 * per-cwd reader. Live streaming + per-project run start/stop stay single-project
 * for now (#393).
 */

/** One project's summary for the Projects sidebar (#314). */
export interface ProjectSummary {
  /** Registry id (stable, URL-safe). */
  id: string
  /** Absolute repo path. */
  path: string
  /** Display name (the path's basename). */
  name: string
  /** True when the repo still has its `.the-framework/` marker. */
  activated: boolean
  /** ISO timestamp of the newest `LOGS.md` entry, when any. */
  lastActivityAt?: string
}

/** Injectable readers so {@link summarizeProject} is unit-testable off disk. */
export interface SummarizeDeps {
  isActivated?: (path: string) => Promise<boolean>
  readLogs?: (path: string) => Promise<LogEntry[]>
}

/**
 * Derive a {@link ProjectSummary} from a registry record: its display name, whether
 * it is still activated, and its last activity (the newest `LOGS.md` entry, since
 * {@link readLogs} returns newest-first). Forgiving: a failed read reads as an
 * inactive project with no activity, never a throw.
 */
export async function summarizeProject(record: ProjectRecord, deps: SummarizeDeps = {}): Promise<ProjectSummary> {
  const checkActivated = deps.isActivated ?? isActivated
  const loadLogs = deps.readLogs ?? readLogs
  const activated = await checkActivated(record.path).catch(() => false)
  const logs = await loadLogs(record.path).catch(() => [] as LogEntry[])
  const lastActivityAt = logs[0]?.at
  const summary: ProjectSummary = {
    id: record.id,
    path: record.path,
    name: basename(record.path),
    activated,
  }
  if (lastActivityAt) summary.lastActivityAt = lastActivityAt
  return summary
}

/**
 * Reads the registry to serve the multi-project endpoints. The dashboard server
 * holds one of these; the daemon uses the default (the real registry), tests pass
 * a fake so the server is exercised without touching the user's registry.
 */
export interface ProjectsProvider {
  /** Every registered project, summarized, for `GET /api/projects`. */
  list(): Promise<ProjectSummary[]>
  /** The absolute path for a registry id, or `undefined` when unknown. */
  resolvePath(id: string): Promise<string | undefined>
}

/** A {@link ProjectsProvider} backed by the global registry (#390). */
export function defaultProjectsProvider(): ProjectsProvider {
  return {
    async list() {
      const records = await listProjects().catch(() => [])
      return Promise.all(records.map(record => summarizeProject(record)))
    },
    async resolvePath(id) {
      const records = await listProjects().catch(() => [])
      return records.find(record => record.id === id)?.path
    },
  }
}
