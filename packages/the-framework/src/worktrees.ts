import { join } from 'node:path'
import { formatBytes } from './format-bytes.js'
import { errorMessage } from './error-message.js'
import {
  listWorktreeDirs,
  listRuns,
  readLiveMetas,
  commitPendingWork,
  removeWorktree,
  pruneWorktrees,
  worktreePath,
  worktreeSize,
  isSafeRunId,
  FRAMEWORK_DIR,
  RUNS_DIR,
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

/** Surface-specific work {@link removeProjectWorktree} does once removal is decided on. */
export interface RemoveWorktreeOptions {
  /**
   * Run after the safety checks pass and the work is committed, just before the checkout goes.
   * The dashboard stops the preview serving that tree here (#797); the CLI has none to stop.
   */
  beforeRemove?: (runId: string) => Promise<void>
}

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
 * Remove one retained worktree (#752/#737): the one implementation behind both surfaces that
 * offer it, the `framework worktrees rm` verb and the dashboard's Remove button (#982). They were
 * two copies of the same checks and had already drifted, so a bogus session id read as a raw git
 * error on one and a plain sentence on the other.
 *
 * Refuses while the run is still going — a run's checkout is where its agent is working, and Stop
 * is how you end a run, not pulling the floor out from under it. The run's history was archived
 * into the repo when it finished, so removal costs no history.
 *
 * Commits whatever the checkout is still holding before removing it, exactly as teardown does
 * (#786), and refuses when that commit fails (#982). A worktree is only *retained* when its run
 * failed or was stopped, which is precisely when it is still holding uncommitted agent work — and
 * {@link removeWorktree} forces past a dirty tree, so without this both surfaces reliably deleted
 * the very diff the checkout was kept for.
 */
export async function removeProjectWorktree(
  cwd: string,
  runId: string,
  opts: RemoveWorktreeOptions = {},
): Promise<RemoveResult> {
  if (!isSafeRunId(runId)) return { ok: false, error: `invalid session id: ${runId}` }
  const names = await listWorktreeDirs(cwd).catch((): string[] => [])
  if (!names.includes(runId)) return { ok: false, error: `no worktree for session ${runId}` }
  const live = await readLiveMetas(cwd).catch(() => [])
  if (live.some(run => run.id === runId && run.status === 'running')) {
    return { ok: false, error: 'that session is still going; stop it before removing its worktree' }
  }
  const path = worktreePath(cwd, runId)
  try {
    if (!(await commitPendingWork(path))) {
      return {
        ok: false,
        error: `session ${runId} has uncommitted work that could not be committed; its worktree was kept`,
      }
    }
    await opts.beforeRemove?.(runId)
    await removeWorktree(cwd, path)
    await pruneWorktrees(cwd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** The outcome of {@link deleteProjectRun}. */
export type DeleteRunResult = { ok: true } | { ok: false; error: string }

/** Surface-specific work {@link deleteProjectRun} does, and the file-removal seam for tests. */
export interface DeleteRunOptions {
  /** Run before the worktree comes off disk (stop a preview serving it, as removal does). */
  beforeRemove?: (runId: string) => Promise<void>
  /** Remove one file, tolerant of an absent one. Defaults to `rm(path, { force: true })`. */
  removeFile?: (path: string) => Promise<void>
}

async function rmFile(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises')
  await rm(path, { force: true })
}

/**
 * Delete a session (#1032): take it out of the dashboard, records and all.
 *
 * This is the sibling of {@link removeProjectWorktree}, and the difference is the whole point.
 * Remove-worktree reclaims the checkout on disk and keeps the session — its row, its replayable
 * log — because the history was already archived. Delete removes that archive too: the run meta
 * (`runs/<id>.json`, what the rail lists) and its event log (`runs/<id>.jsonl`, what replays), so
 * the row is gone for good. It is the one destructive-of-history action, which is why the surfaces
 * that call it confirm first.
 *
 * What it deliberately leaves is git's, not the dashboard's: the branch `the-framework/run-<id>`
 * (or the name the agent gave it) and its commits, the committed `LOGS.md` line, and the
 * conversation record. Deleting a branch that may carry merged work or an open PR is not a thing a
 * dashboard action should do silently, so the branch stays and delete means "remove from the
 * dashboard", not "erase every trace".
 *
 * Refuses while the run is still going — Stop is how a run ends. Any uncommitted work in the
 * worktree is discarded with it, which is the intent here (the session is being thrown away),
 * unlike remove-worktree, which commits that work to the kept branch first.
 */
export async function deleteProjectRun(cwd: string, runId: string, opts: DeleteRunOptions = {}): Promise<DeleteRunResult> {
  if (!isSafeRunId(runId)) return { ok: false, error: `invalid session id: ${runId}` }
  const live = await readLiveMetas(cwd).catch(() => [])
  if (live.some(run => run.id === runId && run.status === 'running')) {
    return { ok: false, error: 'that session is still going; stop it before deleting it' }
  }
  const removeFile = opts.removeFile ?? rmFile
  try {
    // The worktree first, if one is on disk: force-removed (its uncommitted work goes with the
    // session), where remove-worktree would have committed it to the kept branch.
    const names = await listWorktreeDirs(cwd).catch((): string[] => [])
    if (names.includes(runId)) {
      await opts.beforeRemove?.(runId)
      await removeWorktree(cwd, worktreePath(cwd, runId))
      await pruneWorktrees(cwd)
    }
    // Then the records that put the row in the list. Tolerant of an absent file, so a half-deleted
    // session (its worktree already gone) still finishes cleanly.
    const runsDir = join(cwd, FRAMEWORK_DIR, RUNS_DIR)
    await removeFile(join(runsDir, `${runId}.json`))
    await removeFile(join(runsDir, `${runId}.jsonl`))
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
