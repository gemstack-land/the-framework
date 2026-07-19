import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from '../project.js'
import { FRAMEWORK_DIR, isSafeRunId } from './run-store.js'

/**
 * Git-worktree lifecycle for concurrent runs (#453/#735): give each run its own
 * checkout so N runs on one repo never fight over the working tree. Pure plumbing
 * over the existing {@link GitRunner} seam; no daemon wiring, no concurrency, no
 * dashboard changes (those are the sibling #453 slices). This module only knows
 * how to add, list, remove, and prune worktrees.
 */

/** Per-run worktrees live under `<repo>/.the-framework/worktrees/`. Already kept
 *  out of git by the install-time `.the-framework/.gitignore` (`*` rule, #313), so
 *  a worktree's checkout never shows up as dirty in the parent. */
export const WORKTREES_DIR = 'worktrees'

/** The path a run's worktree gets: `<repo>/.the-framework/worktrees/<runId>`. */
export function worktreePath(repo: string, runId: string): string {
  return join(repo, FRAMEWORK_DIR, WORKTREES_DIR, runId)
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
 * Remove a run's worktree: `git worktree remove --force <path>` (force so an
 * in-progress checkout with untracked build output still tears down). Tolerant of
 * an already-gone / never-registered path so teardown stays idempotent (the run
 * child is detached; the daemon only holds its pid).
 */
export async function removeWorktree(repo: string, path: string, run: GitRunner = nodeGitRunner()): Promise<void> {
  try {
    await run(['worktree', 'remove', '--force', path], repo)
  } catch {
    // Already removed, or never registered: nothing to do.
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
