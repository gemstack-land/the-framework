import { readAllRuns, readLiveMetas, type LiveRun, type RunMeta, type RunStatus } from '../store/index.js'
import type { ProjectSummary } from './projects.js'
import { collectQueue, type ProjectQueue } from './queue.js'
import { readTickets, type WorkspaceTicket } from './tickets.js'

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

/** One recent session, tagged with the project it belongs to, for the cross-project rail. */
export interface RecentRun {
  projectId: string
  projectName: string
  run: RunMeta
}

/** How many recent projects the Overview surfaces. */
const RECENT_LIMIT = 5

/** How many recent sessions the home rail pools across every project. */
const RECENT_RUNS_LIMIT = 30

/** Injectable reader so {@link buildRecentRuns} is unit-testable off disk. */
export interface RecentRunsDeps {
  runs?: (cwd: string) => Promise<RunMeta[]>
}

/**
 * Every project's sessions pooled and sorted newest-first (capped), so the shared sidebar (#shared-
 * shell) can show recents on the home/Overview where no single project is selected. Each row carries
 * the project it belongs to, so selecting it jumps into that project's session. Forgiving — a project
 * whose runs cannot be read simply contributes nothing.
 */
export async function buildRecentRuns(projects: ProjectSummary[], deps: RecentRunsDeps = {}): Promise<RecentRun[]> {
  const readRuns = deps.runs ?? readAllRuns
  const all: RecentRun[] = []
  for (const project of projects) {
    for (const run of await readRuns(project.path).catch(() => [])) {
      all.push({ projectId: project.id, projectName: project.name, run })
    }
  }
  all.sort((a, b) => (b.run.startedAt ?? '').localeCompare(a.run.startedAt ?? ''))
  return all.slice(0, RECENT_RUNS_LIMIT)
}

/** Which lane of the "hot tickets" overview (#1112) a ticket sits in. */
export type HotBucket = 'in-progress' | 'next' | 'queued'

/** One ticket surfaced on the Overview's hot-tickets card, tagged with its project and lane. */
export interface HotTicket {
  projectId: string
  projectName: string
  bucket: HotBucket
  ticket: WorkspaceTicket
}

/** Priority values that read as "do this soon" — the "likely next" lane (#1112). */
const HIGH_PRIORITY = new Set(['high', 'urgent', 'critical', 'p0', 'p1', '0', '1'])

/**
 * A ticket's lane (#1112):
 * - in-progress: the agent has planned or spiked it, i.e. work is under way. (There is no run↔ticket
 *   link, so a ticket being *implemented* right now is only visible through the plan/spike it left.)
 * - next: no plan/spike yet, but flagged high priority — likely the next thing picked up.
 * - queued: everything else open, the backlog waiting its turn.
 */
export function ticketBucket(ticket: WorkspaceTicket): HotBucket {
  if (ticket.planned || ticket.spiked) return 'in-progress'
  if (ticket.priority && HIGH_PRIORITY.has(ticket.priority)) return 'next'
  return 'queued'
}

/** How many hot tickets the Overview pools before the card trims per lane. */
const HOT_TICKETS_LIMIT = 60

/** Injectable reader so {@link buildHotTickets} is unit-testable off disk. */
export interface HotTicketsDeps {
  tickets?: (cwd: string) => Promise<WorkspaceTicket[]>
}

/**
 * Every project's tickets pooled and bucketed for the Overview's "hot tickets" card (#1112): what
 * is being worked on (planned/spiked), what is likely next (high priority), and the queued rest.
 * Ordered lane-first (in-progress, then next, then queued), file order within a lane. Forgiving —
 * a project whose tickets cannot be read simply contributes nothing.
 */
export async function buildHotTickets(projects: ProjectSummary[], deps: HotTicketsDeps = {}): Promise<HotTicket[]> {
  const readT = deps.tickets ?? readTickets
  const all: HotTicket[] = []
  for (const project of projects) {
    for (const ticket of await readT(project.path).catch(() => [])) {
      all.push({ projectId: project.id, projectName: project.name, bucket: ticketBucket(ticket), ticket })
    }
  }
  const lane: Record<HotBucket, number> = { 'in-progress': 0, next: 1, queued: 2 }
  all.sort((a, b) => lane[a.bucket] - lane[b.bucket])
  return all.slice(0, HOT_TICKETS_LIMIT)
}

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
