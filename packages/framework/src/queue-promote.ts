import type { GitRunner } from './project.js'
import { nodeGitRunner } from './project.js'
import { FLAT_TODO_FILE } from './tickets.js'

/**
 * Promoting the agent queue out of a finished run's branch and into the project checkout (#852).
 *
 * Runs happen in their own git worktree (#736), which is right for code and wrong for the queue:
 * `TODO_AGENTS.md` is shared mutable state, and a worktree forks it. So a quick-wins run (#773)
 * wrote a perfectly good queue onto a branch nobody reads, auto PM kept seeing an empty checkout,
 * and it re-derived the same entries every cooldown, forever, spending real quota each time.
 *
 * Rom settled the destination on #624: the queue is a durable global `TODO_AGENTS.md` the session
 * writes directly, unlike a *proposal* (a ticket), which is a PR for a human to accept. So the
 * queue belongs in the checkout, and nothing should have to be merged by hand for the loop to turn.
 *
 * The daemon does this, not the agent. The agent stays sandboxed in its worktree with no write
 * access to the project checkout; the daemon copies one known file across, and commits only that
 * pathspec. Narrow enough to audit in a single log line.
 *
 * Conservative everywhere it is not certain: anything unexpected skips with a reason and leaves the
 * checkout untouched. A skipped promotion costs one idle cycle; a wrong one touches a repo a human
 * is working in.
 */

/** Why a promotion did not happen, or that it did. */
export type QueuePromotion =
  | { promoted: true; branch: string }
  | { promoted: false; reason: string }

/** The commit message a promotion writes. Names the run so the history says where it came from. */
export function promotionMessage(runId: string): string {
  return `[The Framework] queue updates from ${runId}`
}

/**
 * Copy `TODO_AGENTS.md` from a finished run's branch into the project checkout and commit it.
 *
 * Skips, rather than forcing, when:
 * - the run recorded no branch (nothing to read from)
 * - the branch has no queue file, or it matches the checkout already (nothing to do)
 * - the checkout has uncommitted changes to the queue file — a human is mid-edit, and their work
 *   outranks an unattended tidy-up
 *
 * Never throws: this runs on a background tick with nothing to catch it.
 */
export async function promoteQueue(
  projectCwd: string,
  run: { id: string; branch?: string | undefined },
  git: GitRunner = nodeGitRunner(),
): Promise<QueuePromotion> {
  const branch = run.branch
  if (!branch) return { promoted: false, reason: 'the run recorded no branch' }

  try {
    // The queue as the run left it. A run that never touched it has no such path on the branch.
    const fromBranch = await git(['show', `${branch}:${FLAT_TODO_FILE}`], projectCwd).catch(() => undefined)
    if (fromBranch === undefined) return { promoted: false, reason: 'the run left no queue file on its branch' }

    const inCheckout = await git(['show', `HEAD:${FLAT_TODO_FILE}`], projectCwd).catch(() => '')
    if (fromBranch === inCheckout) return { promoted: false, reason: 'the queue is already up to date' }

    // A dirty queue file means someone is editing it by hand right now. Leave it alone; the next
    // tick will try again, and until then auto PM simply does not start more work.
    const dirty = (await git(['status', '--porcelain', '--', FLAT_TODO_FILE], projectCwd)).trim()
    if (dirty) return { promoted: false, reason: 'the checkout has uncommitted queue changes' }

    // `checkout <branch> -- <path>` writes the file and stages it in one step, touching nothing
    // else in the tree. The commit is pathspec-scoped for the same reason: whatever else is
    // staged in the user's checkout is theirs and must not ride along.
    await git(['checkout', branch, '--', FLAT_TODO_FILE], projectCwd)
    await git(['commit', '-m', promotionMessage(run.id), '--', FLAT_TODO_FILE], projectCwd)
    return { promoted: true, branch }
  } catch (err) {
    return { promoted: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
