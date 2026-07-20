import { basename } from 'node:path'
import { listProjects, type ProjectRecord } from '../registry.js'
import { isActivated } from '../project.js'
import { loadFrameworkConfig, type FrameworkFileConfig } from '../config.js'
import { readLogs, type LogEntry } from '../logs.js'
import { listRuns, readLiveMetas, type LiveRun, type RunMeta } from '../store/index.js'

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
  /** ISO timestamp of the project's newest activity: the latest `LOGS.md` entry or run, whichever is newer. */
  lastActivityAt?: string
  /**
   * The repo's committed run defaults from `the-framework.yml` (#842), so the launcher can show
   * what a run there will actually resolve to. Read fresh on every summarize, which is what keeps
   * it current after an edit; absent when the repo sets nothing (or the file is malformed, which
   * {@link loadFrameworkConfig} reports as empty rather than failing).
   */
  fileConfig?: FrameworkFileConfig
}

/** Injectable readers so {@link summarizeProject} is unit-testable off disk. */
export interface SummarizeDeps {
  isActivated?: (path: string) => Promise<boolean>
  readLogs?: (path: string) => Promise<LogEntry[]>
  /** The project's runs (live + archived), newest-first. Defaults to {@link readAllRuns}. */
  readRuns?: (path: string) => Promise<RunMeta[]>
  /** The repo's `the-framework.yml` (#842). Defaults to {@link loadFrameworkConfig}. */
  readFileConfig?: (path: string) => Promise<FrameworkFileConfig>
}

/** A project's runs, live prepended to the archived history. Forgiving: a failed read is `[]`. */
async function readAllRuns(path: string): Promise<RunMeta[]> {
  const [archived, live] = await Promise.all([
    listRuns(path).catch(() => [] as RunMeta[]),
    readLiveMetas(path).catch(() => [] as LiveRun[]),
  ])
  // Dedup by id like every other reader: a live run that has since been archived is one run.
  // Live wins over archived (#768). The dedup used to drop the live copy, which was right while
  // "archived" meant "finished for good": a run was only ever copied into `runs/` on its way out.
  // Continuing a run (#762) breaks that — the run has an archived copy from its first leg AND is
  // live again — and keeping the archive showed a running run as finished.
  return [...live, ...archived.filter(run => !live.some(l => l.id === run.id))]
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
  const loadRuns = deps.readRuns ?? readAllRuns
  const loadFileConfig = deps.readFileConfig ?? (path => loadFrameworkConfig(path))
  const activated = await checkActivated(record.path).catch(() => false)
  const [logs, runs, fileConfig] = await Promise.all([
    loadLogs(record.path).catch(() => [] as LogEntry[]),
    loadRuns(record.path).catch(() => [] as RunMeta[]),
    loadFileConfig(record.path).catch(() => ({}) as FrameworkFileConfig),
  ])
  // Newest of the latest LOGS.md entry and the latest run: a run is activity even
  // when it stopped before writing to LOGS.md. ISO timestamps sort chronologically.
  const runActivity = runs.map(r => r.updatedAt || r.startedAt).filter(Boolean)
  const lastActivityAt = [logs[0]?.at, ...runActivity].filter((a): a is string => !!a).sort().at(-1)
  const summary: ProjectSummary = {
    id: record.id,
    path: record.path,
    name: basename(record.path),
    activated,
  }
  if (lastActivityAt) summary.lastActivityAt = lastActivityAt
  // Omitted when the repo sets nothing, so a project with no yml carries no key at all.
  if (Object.keys(fileConfig).length) summary.fileConfig = fileConfig
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

/**
 * A {@link ProjectsProvider} scoped to one workspace (#427): the per-run foreground
 * dashboard and `--resume` serve the new SPA for a single `cwd` without touching the
 * global registry, so a one-shot run never pollutes the Projects list. `list()` yields
 * exactly that project (the SPA auto-selects the sole entry), and `resolvePath` returns
 * its `cwd` for the fixed `id` — every read RPC + the event Channel then read the run's
 * own `.the-framework/` files. An unknown id resolves to nothing, as with the registry.
 */
/**
 * A {@link ProjectsProvider} that knows no projects (#426): `list()` is empty and
 * `resolvePath` never resolves. The relay passes this so the file/registry-backed RPCs
 * (runs, docs, log, and any steer) return nothing on a public, unauthenticated host — it
 * only serves the live event stream from its own in-memory run (via `eventsSource`).
 */
export function emptyProjectsProvider(): ProjectsProvider {
  return {
    async list() {
      return []
    },
    async resolvePath() {
      return undefined
    },
  }
}

export function singleProjectProvider(cwd: string, id = 'home'): ProjectsProvider {
  return {
    async list() {
      // addedAt is unused by summarizeProject (last activity comes from LOGS.md).
      return [await summarizeProject({ id, path: cwd, addedAt: '' })]
    },
    async resolvePath(reqId) {
      return reqId === id ? cwd : undefined
    },
  }
}
