import { listProjectWorktrees, removeProjectWorktree, type RemoveResult, type WorktreeRow } from './worktrees.js'
import { listRuns, type RunMeta } from './store/index.js'
import { readRunHandoff, runBranchFor, type RunHandoff } from './dashboard/run-handoff.js'

// Auto-remove a session's worktree once its branch has landed (#1036).
//
// A run that failed or was stopped keeps its checkout so you can look at what it was holding
// (#752), and nothing removed those on a timer — so a machine accumulated a full checkout per
// such session forever, and the only cure was noticing and clicking Remove. Once the work has
// landed, the checkout is the one copy of it that costs disk and carries no information: the
// commits are in the base, the branch is still there, and the session's row and replayable log
// are untouched.
//
// It removes the *checkout*, never the history. That is `removeProjectWorktree`'s existing
// contract (#752/#982) and the whole reason this can be automatic: the branch stays, the session
// stays, and everything this deletes is reconstructable with `git worktree add`.

/** How a branch was found to have landed. */
export type LandedVia = 'branch' | 'pr'

/** One worktree this sweep removed. */
export interface RemovedWorktree {
  /** The run id, which is also the worktree's directory name. */
  runId: string
  branch: string
  /** Which signal said it landed: merged into the base locally, or a merged PR on GitHub. */
  via: LandedVia
}

/** A landed worktree that could not be removed, and git's reason. */
export interface FailedRemoval {
  runId: string
  error: string
}

/** What {@link removeMergedWorktrees} did. */
export interface MergedSweepResult {
  removed: RemovedWorktree[]
  /** Landed worktrees whose removal failed. A worktree that has *not* landed is not reported: it was never a candidate. */
  failed: FailedRemoval[]
}

/** Injectable seams so the sweep is unit-testable off disk. */
export interface MergedSweepDeps {
  /** The worktrees on disk (default {@link listProjectWorktrees}). */
  worktrees?: (cwd: string) => Promise<WorktreeRow[]>
  /** The project's archived runs (default {@link listRuns}), for the branch a row did not record. */
  runs?: (cwd: string) => Promise<RunMeta[]>
  /** Reads a branch's state (default {@link readRunHandoff}). */
  handoff?: (cwd: string, branch: string) => Promise<RunHandoff | undefined>
  /** Removes one worktree (default {@link removeProjectWorktree}). */
  remove?: (cwd: string, runId: string) => Promise<RemoveResult>
}

/**
 * Whether a branch's state counts as landed, and by which signal.
 *
 * Both signals, because either one alone is wrong here.
 *
 * `merged` (`git branch --merged <base>`) is the stronger of the two: it is proof the commits are
 * reachable from the local base, which is exactly the "still recoverable" bar this feature has to
 * clear before deleting anything. But it only holds for a merge that kept the commits — a squash
 * or rebase merge rewrites them, so the branch never becomes an ancestor of the base and this
 * signal never fires. On a repo with squash-merge on (this one included) that is most merges, and
 * a sweep gated on it alone would almost never run.
 *
 * A merged PR closes that gap: GitHub saying MERGED is a statement that the work is in the base
 * branch, however it was squashed getting there. It is the weaker signal only in that it describes
 * the remote — which is why the branch is kept either way, so a base you have not fetched yet
 * still leaves the commits sitting locally on the branch.
 *
 * Deliberately not `pr.state === 'CLOSED'`: a closed-unmerged PR means the work was *rejected*,
 * and the checkout of rejected work is the one a human is most likely to still want to read.
 */
export function landedVia(state: RunHandoff): LandedVia | undefined {
  if (state.merged) return 'branch'
  if (state.pr?.state === 'MERGED') return 'pr'
  return undefined
}

/**
 * Remove every retained worktree in `cwd` whose branch has landed (#1036).
 *
 * Conservative at every step where the answer is not clear: a live run keeps its checkout (it is
 * where its agent is working), a branch that no longer exists is left alone, and a branch whose
 * state cannot be read is skipped rather than guessed at — an unreadable repo must never be a
 * reason to delete a checkout.
 *
 * Removal itself is {@link removeProjectWorktree}, not a second copy of it, so the automatic path
 * and the two manual ones (`framework worktrees rm`, the dashboard's Remove button) are one
 * behaviour. That also means uncommitted work in a landed checkout is committed to the kept branch
 * before the checkout goes, exactly as it is when a human removes it: still recoverable, just no
 * longer occupying disk.
 */
export async function removeMergedWorktrees(cwd: string, deps: MergedSweepDeps = {}): Promise<MergedSweepResult> {
  // Sizes off: `du` over every retained checkout is the expensive part of the listing, and a sweep
  // that only decides removal never reads the number.
  const worktrees = deps.worktrees ?? ((path: string) => listProjectWorktrees(path, { sizes: false }))
  const runs = deps.runs ?? listRuns
  const handoff = deps.handoff ?? readRunHandoff
  const remove = deps.remove ?? removeProjectWorktree

  const result: MergedSweepResult = { removed: [], failed: [] }
  const rows = await worktrees(cwd).catch((): WorktreeRow[] => [])
  if (rows.length === 0) return result
  // Read once for the whole sweep: `runBranchFor` falls back to the session name for a run
  // archived before the branch was recorded (#799), and the row does not carry one.
  const metas = await runs(cwd).catch((): RunMeta[] => [])

  for (const row of rows) {
    // A run's checkout is where its agent is working. Stop is how you end a run.
    if (row.live) continue
    const meta = metas.find(run => run.id === row.runId)
    const branch = runBranchFor(meta ?? { id: row.runId, ...(row.branch ? { branch: row.branch } : {}) })
    const state = await handoff(cwd, branch).catch(() => undefined)
    // No answer, or the branch is gone: not evidence the work landed, so the checkout stays.
    // A branch that no longer exists is the one case where the "recoverable from git" promise
    // would be a lie, which makes it the last checkout to delete rather than the first.
    if (!state || !state.exists) continue
    const via = landedVia(state)
    if (!via) continue
    const outcome = await remove(cwd, row.runId)
    if (outcome.ok) result.removed.push({ runId: row.runId, branch, via })
    else result.failed.push({ runId: row.runId, error: outcome.error })
  }
  return result
}

/**
 * How long between sweeps.
 *
 * Ten minutes, because merging is human-paced: nobody merges a PR and then watches for the
 * checkout to disappear, and the reason this exists is disk reclaimed over days. It is also what
 * the sweep costs — a `gh pr view` per retained worktree, behind a 60s cache — so a minute-poll
 * would spend an order of magnitude more `gh` on an answer that changes a few times a day.
 */
export const DEFAULT_MERGED_SWEEP_INTERVAL_MS = 10 * 60 * 1000

/** A running sweep, in the shape the daemon's other background services use. */
export interface MergedWorktreeSweep {
  /** Run one sweep now, awaiting it. Exposed for tests and for a caller that wants it on demand. */
  tick: () => Promise<void>
  stop: () => void
}

/** What {@link startMergedWorktreeSweep} needs from the daemon. */
export interface MergedSweepOptions {
  /** The registered projects to sweep. */
  projects: () => Promise<readonly { path: string }[]>
  log: (message: string) => void
  intervalMs?: number
  /** The per-project sweep (default {@link removeMergedWorktrees}). */
  sweep?: (cwd: string) => Promise<MergedSweepResult>
}

/**
 * Sweep every registered project's landed worktrees on a timer (#1036).
 *
 * Says what it removed rather than removing it silently: a checkout vanishing from under someone
 * with no line explaining why reads as a bug, even when the work behind it is safe.
 *
 * Runs immediately on start and then every {@link DEFAULT_MERGED_SWEEP_INTERVAL_MS}; overlapping
 * ticks are dropped, and the timer is unref'd so a background sweep is never the reason the
 * process stays up.
 */
export function startMergedWorktreeSweep(opts: MergedSweepOptions): MergedWorktreeSweep {
  const sweep = opts.sweep ?? removeMergedWorktrees
  let stopped = false

  const sweepAll = async (): Promise<void> => {
    for (const project of await opts.projects().catch(() => [])) {
      if (stopped) break
      const { removed, failed } = await sweep(project.path).catch((): MergedSweepResult => ({ removed: [], failed: [] }))
      for (const item of removed) {
        opts.log(
          `[framework] removed the worktree for session ${item.runId}: ${item.branch} ${
            item.via === 'pr' ? 'was merged on GitHub' : 'is merged into the base'
          }. The branch and the session are kept.`,
        )
      }
      for (const item of failed) {
        opts.log(`[framework] could not remove the landed worktree for session ${item.runId}: ${item.error}`)
      }
    }
  }

  // Overlapping ticks join the sweep already running rather than being dropped: awaiting `tick()`
  // has to mean the sweep finished, or an on-demand caller (and a test) gets a silent no-op
  // whenever the timer or the start-up sweep happens to be mid-flight.
  let inflight: Promise<void> | undefined
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    inflight ??= sweepAll().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  // Swept once at start-up, not only after the first interval: the case this exists for is a
  // machine that was off (or a daemon that was down) while the work was merged.
  void tick()
  const timer = setInterval(() => void tick(), opts.intervalMs ?? DEFAULT_MERGED_SWEEP_INTERVAL_MS)
  timer.unref?.()
  return {
    tick,
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}
