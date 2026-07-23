import { readLiveMetas, type LiveRun, type RunStatus } from '../store/index.js'
import type { ProjectSummary } from './projects.js'
import { collectQueue, type ProjectQueue } from './queue.js'

// The first-sidebar Overview (#437, part of #314): a cross-project glance at what the agent
// is working on right now, the size of the backlog, and the recently active projects. It
// rolls up three existing file projections across the whole registry — the live run meta
// (`.the-framework/run.json`, kept current per event), the TODO queue (queue.ts), and each
// project's last activity (ProjectSummary.lastActivityAt from LOGS.md).

/** One project's in-flight run, surfaced in the Overview's "working now" list. */
export interface ActiveRun {
  projectId: string
  projectName: string
  /** Which run this is (#738): a project can have several in flight, one per worktree. */
  runId: string
  /** The run's own checkout, so its git/file status is read from the worktree it edits (#738). */
  cwd: string
  status: RunStatus
  /** What the user asked to build (the run's `scope` event). */
  intent?: string
  scope?: string
  /** ISO timestamp of the run's last event. */
  updatedAt?: string
  /** The session name the agent chose (#326), when it set one. */
  sessionName?: string
  /** Whether the agent signalled `setReadyForMerge()` (#326): drives the building/ready dot. */
  readyForMerge?: boolean
}

/** One recently active project, most-recent first. */
export interface RecentProject {
  projectId: string
  projectName: string
  lastActivityAt?: string
}

/** The cross-project Overview payload. */
export interface Overview {
  /** Projects with a running run, most-recently-updated first. */
  active: ActiveRun[]
  /** Total open TODO items across every project. */
  queueOpen: number
  /** The most recently active projects (capped). */
  recent: RecentProject[]
}

/** How many recent projects the Overview surfaces. */
const RECENT_LIMIT = 5

/** Injectable readers so {@link buildOverview} is unit-testable off disk. */
export interface OverviewDeps {
  liveRuns?: (cwd: string) => Promise<LiveRun[]>
  queue?: (projects: ProjectSummary[]) => Promise<ProjectQueue[]>
}

/**
 * Build the cross-project Overview: the running runs (every live run of each project, one per
 * worktree since #736), the total open TODO count (from {@link collectQueue}), and the most
 * recently active projects (by {@link ProjectSummary.lastActivityAt}). Forgiving — a project
 * with no live run, or none running, simply contributes nothing to `active`.
 */
export async function buildOverview(projects: ProjectSummary[], deps: OverviewDeps = {}): Promise<Overview> {
  const liveRuns = deps.liveRuns ?? readLiveMetas
  const queue = deps.queue ?? (p => collectQueue(p))

  const active: ActiveRun[] = []
  for (const project of projects) {
    // Every live run of the project (#738), not just the one that used to sit at its path.
    for (const meta of await liveRuns(project.path).catch(() => [])) {
      if (meta.status !== 'running') continue
      active.push({
        projectId: project.id,
        projectName: project.name,
        runId: meta.id,
        cwd: meta.cwd,
        status: meta.status,
        ...(meta.intent ? { intent: meta.intent } : {}),
        ...(meta.scope ? { scope: meta.scope } : {}),
        ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
        ...(meta.sessionName ? { sessionName: meta.sessionName } : {}),
        ...(meta.readyForMerge ? { readyForMerge: true } : {}),
      })
    }
  }
  active.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

  const queues = await queue(projects)
  const queueOpen = queues.reduce((sum, q) => sum + q.open, 0)

  const recent = projects
    .filter(p => p.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    .slice(0, RECENT_LIMIT)
    .map(p => ({ projectId: p.id, projectName: p.name, lastActivityAt: p.lastActivityAt! }))

  return { active, queueOpen, recent }
}
