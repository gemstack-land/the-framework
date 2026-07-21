import { formatBytes } from './format-bytes.js'
import { errorMessage } from './error-message.js'
import {
  listWorktreeDirs,
  listRuns,
  readLiveMetas,
  removeWorktree,
  pruneWorktrees,
  worktreePath,
  worktreeSize,
  isSafeRunId,
  type RunStatus,
} from './store/index.js'

/** A retained worktree and the run that left it behind (#752). */
export interface WorktreeRow {
  /** The run id, which is also the worktree's directory name. */
  runId: string
  /** The branch the run's work landed on, when its meta recorded one (#799). */
  branch?: string
  /** How the run that left this checkout ended, or `running` while it is still going. */
  status?: RunStatus
  /** Size on disk in bytes, absent for a live run (its tree is still changing) or when unreadable. */
  sizeBytes?: number
  /** True while the run owning this checkout is still going: it is in use, not retained. */
  live: boolean
}

/** Why a worktree was left in place by {@link pruneProjectWorktrees}. */
export interface SkippedWorktree {
  runId: string
  reason: string
}

/** What {@link pruneProjectWorktrees} did. */
export interface PruneResult {
  removed: string[]
  skipped: SkippedWorktree[]
}

/** The outcome of {@link removeProjectWorktree}. */
export type RemoveResult = { ok: true } | { ok: false; error: string }

/**
 * The worktrees a project still has on disk (#752), newest first — the same view the dashboard's
 * retained-worktrees list is built from, through the same store reads, so the CLI is a second
 * surface rather than a second behaviour.
 *
 * A live run's checkout is included and flagged rather than hidden: "what is this directory and
 * why can I not remove it" is exactly the question the list has to answer.
 */
export async function listProjectWorktrees(cwd: string, opts: { sizes?: boolean } = {}): Promise<WorktreeRow[]> {
  const [names, live, archived] = await Promise.all([
    listWorktreeDirs(cwd).catch(() => []),
    readLiveMetas(cwd).catch(() => []),
    listRuns(cwd).catch(() => []),
  ])
  const rows: WorktreeRow[] = []
  for (const runId of names) {
    const meta = live.find(run => run.id === runId) ?? archived.find(run => run.id === runId)
    const isLive = meta?.status === 'running'
    rows.push({
      runId,
      live: isLive,
      ...(meta?.branch ? { branch: meta.branch } : {}),
      ...(meta?.status ? { status: meta.status } : {}),
      // Sizing a tree an agent is writing to gives a number that is wrong by the time it prints;
      // a caller that only wants the rows (the dashboard's retained list) skips the du entirely.
      ...(isLive || opts.sizes === false ? {} : await sizeOf(cwd, runId)),
    })
  }
  return rows.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0))
}

async function sizeOf(cwd: string, runId: string): Promise<{ sizeBytes?: number }> {
  const bytes = await worktreeSize(worktreePath(cwd, runId)).catch(() => undefined)
  return bytes === undefined ? {} : { sizeBytes: bytes }
}

/**
 * Remove one retained worktree (#752/#737), refusing while its run is still going — a run's
 * checkout is where its agent is working, and Stop is how you end a run, not pulling the floor
 * out from under it. The run's history was archived into the repo when it finished, so removal
 * costs no history.
 *
 * Unlike the dashboard's Remove, this cannot stop a preview serving that checkout: previews live
 * in the daemon, and the CLI is a different process. A worktree being served is still removed;
 * the dev server is the daemon's to notice.
 */
export async function removeProjectWorktree(cwd: string, runId: string): Promise<RemoveResult> {
  if (!isSafeRunId(runId)) return { ok: false, error: `invalid session id: ${runId}` }
  const names = await listWorktreeDirs(cwd).catch((): string[] => [])
  if (!names.includes(runId)) return { ok: false, error: `no worktree for session ${runId}` }
  const live = await readLiveMetas(cwd).catch(() => [])
  if (live.some(run => run.id === runId && run.status === 'running')) {
    return { ok: false, error: 'that session is still going; stop it before removing its worktree' }
  }
  try {
    await removeWorktree(cwd, worktreePath(cwd, runId))
    await pruneWorktrees(cwd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * Remove every retained worktree whose run is not live (#752): the "clean all of this up" case.
 * A live run keeps its checkout and is reported as skipped, so the count always adds up to what
 * the list showed.
 */
export async function pruneProjectWorktrees(cwd: string): Promise<PruneResult> {
  const result: PruneResult = { removed: [], skipped: [] }
  for (const row of await listProjectWorktrees(cwd)) {
    if (row.live) {
      result.skipped.push({ runId: row.runId, reason: 'still running' })
      continue
    }
    const outcome = await removeProjectWorktree(cwd, row.runId)
    if (outcome.ok) result.removed.push(row.runId)
    else result.skipped.push({ runId: row.runId, reason: outcome.error })
  }
  return result
}

/**
 * The `framework worktrees` table (#752). Pure so the layout is testable: columns padded to the
 * widest cell, and a message rather than an empty table when a project has no worktrees.
 */
export function formatWorktreeList(rows: WorktreeRow[]): string[] {
  if (rows.length === 0) return ['No worktrees. A session that finished cleanly does not keep one.']
  const header = ['SESSION', 'STATUS', 'SIZE', 'BRANCH']
  const body = rows.map(row => [
    row.runId,
    row.live ? 'running' : (row.status ?? 'unknown'),
    formatBytes(row.sizeBytes, '-'),
    row.branch ?? '-',
  ])
  const widths = header.map((_, column) => Math.max(...[header, ...body].map(cells => (cells[column] ?? '').length)))
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
      .trimEnd()
  return [line(header), ...body.map(line)]
}
