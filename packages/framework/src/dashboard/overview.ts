import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRAMEWORK_DIR, META_FILE, type RunMeta, type RunStatus } from '../store/index.js'
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
  status: RunStatus
  /** What the user asked to build (the run's `scope` event). */
  intent?: string
  scope?: string
  /** ISO timestamp of the run's last event. */
  updatedAt?: string
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

/** Read a project's live run meta (`.the-framework/run.json`), or undefined when absent/unreadable. */
async function readLiveMeta(cwd: string): Promise<RunMeta | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, FRAMEWORK_DIR, META_FILE), 'utf8')) as RunMeta
  } catch {
    return undefined
  }
}

/** Injectable readers so {@link buildOverview} is unit-testable off disk. */
export interface OverviewDeps {
  liveMeta?: (cwd: string) => Promise<RunMeta | undefined>
  queue?: (projects: ProjectSummary[]) => Promise<ProjectQueue[]>
}

/**
 * Build the cross-project Overview: the running runs (from each project's live meta), the
 * total open TODO count (from {@link collectQueue}), and the most recently active projects
 * (by {@link ProjectSummary.lastActivityAt}). Forgiving — a project whose meta is missing
 * or not running simply contributes nothing to `active`.
 */
export async function buildOverview(projects: ProjectSummary[], deps: OverviewDeps = {}): Promise<Overview> {
  const liveMeta = deps.liveMeta ?? readLiveMeta
  const queue = deps.queue ?? (p => collectQueue(p))

  const active: ActiveRun[] = []
  for (const project of projects) {
    const meta = await liveMeta(project.path)
    if (meta?.status === 'running') {
      active.push({
        projectId: project.id,
        projectName: project.name,
        status: meta.status,
        ...(meta.intent ? { intent: meta.intent } : {}),
        ...(meta.scope ? { scope: meta.scope } : {}),
        ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
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
