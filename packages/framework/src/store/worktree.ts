import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from '../project.js'
import { FRAMEWORK_DIR, WORKTREES_DIR, isSafeRunId } from './run-store.js'

/**
 * Git-worktree lifecycle for concurrent runs (#453/#735): give each run its own
 * checkout so N runs on one repo never fight over the working tree. Pure plumbing
 * over the existing {@link GitRunner} seam; no daemon wiring, no concurrency, no
 * dashboard changes (those are the sibling #453 slices). This module only knows
 * how to add, list, remove, and prune worktrees.
 */

/** The path a run's worktree gets: `<repo>/.the-framework/worktrees/<runId>`. */
export function worktreePath(repo: string, runId: string): string {
  return join(repo, FRAMEWORK_DIR, WORKTREES_DIR, runId)
}

/**
 * The branch a framework-allocated worktree starts on (#736). The run id exists
 * before the session name does, so the branch is created from the id and renamed
 * by {@link renameRunBranch} once the agent picks a name.
 */
export function runBranchName(runId: string): string {
  return `the-framework/run-${runId}`
}

/** One entry parsed from `git worktree list --porcelain`. */
export interface WorktreeInfo {
  /** Absolute worktree path (the main checkout included). */
  path: string
  /** The checked-out commit. */
  head: string
  /** The checked-out branch (short name), or absent when detached. */
  branch?: string
}

/** Inputs to {@link addWorktree}. The caller owns branch naming (#736). */
export interface AddWorktreeOptions {
  runId: string
  /** The branch to create for the run. */
  branch: string
  /** Base ref to branch from; defaults to the repo's current HEAD. */
  base?: string
}

/** The worktree {@link addWorktree} created. */
export interface AddedWorktree {
  path: string
  branch: string
}

/**
 * Create a worktree for a run on a fresh branch: `git worktree add -b <branch>
 * <path> [base]`. Git makes the leaf dir (and any missing parents) itself. The
 * `runId` is validated as path-safe first so a caller can never traverse out of
 * `.the-framework/worktrees/`. Rejects on any git failure (a caller that wants a
 * run needs its checkout, so failure must surface, not be swallowed).
 */
export async function addWorktree(
  repo: string,
  opts: AddWorktreeOptions,
  run: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  if (!isSafeRunId(opts.runId)) throw new Error(`unsafe run id: ${opts.runId}`)
  const path = worktreePath(repo, opts.runId)
  await run(['worktree', 'add', '-b', opts.branch, path, ...(opts.base ? [opts.base] : [])], repo)
  return { path, branch: opts.branch }
}

/**
 * Check an *existing* branch out into a run's worktree (#762): `git worktree add <path> <branch>`,
 * no `-b`. Continuing a run puts it back on the branch its work is already on, rather than
 * branching again from HEAD and stranding what it did last time.
 *
 * Rejects on git failure, like {@link addWorktree}: a continued run needs its checkout.
 */
export async function attachWorktree(
  repo: string,
  opts: { runId: string; branch: string },
  run: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  if (!isSafeRunId(opts.runId)) throw new Error(`unsafe run id: ${opts.runId}`)
  const path = worktreePath(repo, opts.runId)
  await run(['worktree', 'add', path, opts.branch], repo)
  return { path, branch: opts.branch }
}

/**
 * Every worktree registered for the repo (the main checkout included). Forgiving:
 * a non-repo / git failure yields `[]` so a reconcile scan never throws.
 */
export async function listWorktrees(repo: string, run: GitRunner = nodeGitRunner()): Promise<WorktreeInfo[]> {
  try {
    return parseWorktreeList(await run(['worktree', 'list', '--porcelain'], repo))
  } catch {
    return []
  }
}

/**
 * Parse `git worktree list --porcelain`: blank-line-separated records, each with
 * a `worktree <path>` line, a `HEAD <sha>` line, and either `branch refs/heads/...`
 * or `detached`. Extra attributes (bare/locked/prunable) are ignored. Exported so
 * the parsing is unit-testable without a real repo.
 */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    let path: string | undefined
    let head = ''
    let branch: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim()
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim()
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    }
    if (path) entries.push({ path, head, ...(branch ? { branch } : {}) })
  }
  return entries
}

/**
 * Commit whatever the run left behind, on the run's own branch (#786).
 *
 * An agent that edits and stops without committing is behaving as instructed: the
 * system prompt has it commit *pre-existing* changes before it starts, never its own
 * work at the end. Removing that checkout would destroy the diff (the work was never
 * staged, so it is not recoverable from git afterwards), so teardown commits it first
 * and the branch outlives the worktree.
 *
 * Returns whether the checkout is safe to remove: true when it was already clean or
 * the work is now committed, false when the commit failed (no git identity, a hook
 * refusing it). False means keep the checkout, which is the safe direction.
 */
export async function commitPendingWork(path: string, run: GitRunner = nodeGitRunner()): Promise<boolean> {
  try {
    const status = await run(['status', '--porcelain'], path)
    if (!status.trim()) return true
    await run(['add', '-A'], path)
    // Same wording as the install-time safety commit (install.ts), for one vocabulary.
    await run(['commit', '-m', '[The Framework] uncommitted changes'], path)
    return true
  } catch {
    return false
  }
}

/**
 * Remove a run's worktree. Tolerant of an already-gone / never-registered path so
 * teardown stays idempotent (the run child is detached; the daemon only holds its pid).
 *
 * Plain removal first: it refuses a checkout git considers unclean, which after
 * {@link commitPendingWork} means a state we did not anticipate. Falling back to
 * `--force` keeps teardown working (an ignored build artifact must not strand a
 * worktree forever), but it says so, because forcing past unknown state is exactly
 * how uncommitted work got deleted in the first place.
 */
export async function removeWorktree(repo: string, path: string, run: GitRunner = nodeGitRunner()): Promise<void> {
  try {
    await run(['worktree', 'remove', path], repo)
    return
  } catch {
    // Unclean by git's reckoning, already removed, or never registered: try forcing.
  }
  try {
    await run(['worktree', 'remove', '--force', path], repo)
    console.log(`[framework] forced removal of worktree ${path} (git called it unclean)`)
  } catch {
    // Already removed, or never registered: nothing to do.
  }
}

/**
 * The branch checked out at `path`, or `undefined` when detached / not a repo.
 * Forgiving, like {@link listWorktrees}: callers use it to decide, not to fail.
 */
export async function currentBranch(path: string, run: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  try {
    const name = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim()
    return name && name !== 'HEAD' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * Rename a run's branch once the agent names the session (#736): the worktree is
 * created on `the-framework/run-<runId>` before a name exists, and this puts the
 * readable `the-framework/<sessionName>` on it.
 *
 * Only renames when `path` is still on `from`. The #326 system prompt currently
 * tells the agent to create and check out its own `the-framework/<name>` branch,
 * and until that step is dropped there (the prompt ships verbatim from the issue,
 * so it is not ours to edit) the agent may already have moved off `from` — in
 * which case it named the branch itself and there is nothing to rename. Returns
 * whether it renamed, and never throws: a run must not die over a branch name.
 */
export async function renameRunBranch(
  path: string,
  from: string,
  to: string,
  run: GitRunner = nodeGitRunner(),
): Promise<boolean> {
  if ((await currentBranch(path, run)) !== from) return false
  try {
    await run(['branch', '-m', from, to], path)
    return true
  } catch {
    // Target name taken, or an invalid slug: keep the run-id branch.
    return false
  }
}

/**
 * `git worktree prune`: drop administrative entries for worktree dirs a crash left
 * behind. Never removes a live worktree, so it is always safe. Forgiving.
 */
export async function pruneWorktrees(repo: string, run: GitRunner = nodeGitRunner()): Promise<void> {
  try {
    await run(['worktree', 'prune'], repo)
  } catch {
    // Not a repo / nothing to prune: no-op.
  }
}
