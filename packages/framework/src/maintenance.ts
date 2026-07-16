import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from './project.js'
import { nodeFs } from './node-fs.js'
import { FRAMEWORK_DIR } from './store/index.js'

/**
 * The maintenance sweep (#298): a background job that walks the registered repos,
 * finds the commits each repo has grown since its last maintenance review, and runs
 * the maintainability loop on them. Per-repo review state is a small local file
 * (`.the-framework/maintenance.json`, gitignored) recording the last-reviewed commit,
 * so a sweep only ever acts on new work. The capacity gate is the existing budget cap
 * (`--max-cost`). #298's "check the limit" half is reachable after all — the agent
 * reports the account's quota per turn (#517) and on demand (#521) — but this sweep
 * does not gate on it yet; that is #519's consumption limits.
 */

/** The per-repo review-state filename under `.the-framework/`. */
export const MAINTENANCE_FILE = 'maintenance.json'

/** What a repo's last maintenance review recorded. */
export interface MaintenanceState {
  /** The HEAD commit the maintenance loop last reviewed (a full SHA). */
  reviewedSha?: string
  /** ISO timestamp of that review. */
  reviewedAt?: string
}

/** Minimal fs seam so the state IO is unit-testable without touching disk. */
export interface MaintenanceFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  mkdir(path: string): Promise<void>
}

/** A {@link MaintenanceFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeMaintenanceFs(): MaintenanceFs {
  const { read, write, mkdir } = nodeFs()
  return { read, write, mkdir }
}

/** The review-state file path for a repo. */
export function maintenanceStatePath(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR, MAINTENANCE_FILE)
}

/** Read a repo's review state. Forgiving: a missing/unreadable/malformed file yields `{}`. */
export async function readMaintenanceState(cwd: string, fs: MaintenanceFs = nodeMaintenanceFs()): Promise<MaintenanceState> {
  try {
    const parsed = JSON.parse(await fs.read(maintenanceStatePath(cwd))) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const state: MaintenanceState = {}
      if (typeof record['reviewedSha'] === 'string') state.reviewedSha = record['reviewedSha']
      if (typeof record['reviewedAt'] === 'string') state.reviewedAt = record['reviewedAt']
      return state
    }
  } catch {
    // absent / unreadable / malformed -> no prior review
  }
  return {}
}

/** Record a repo's review state, creating `.the-framework/` as needed. */
export async function writeMaintenanceState(
  cwd: string,
  state: MaintenanceState,
  fs: MaintenanceFs = nodeMaintenanceFs(),
): Promise<void> {
  await fs.mkdir(join(cwd, FRAMEWORK_DIR))
  await fs.write(maintenanceStatePath(cwd), JSON.stringify(state, null, 2))
}

/** What the sweep decided for one repo. */
export type MaintenanceAction = 'baseline' | 'review' | 'skip' | 'error'

/** A repo's assessed maintenance status. */
export interface RepoReview {
  /** Registry id, when assessed from the registry. */
  id?: string
  /** Absolute repo path. */
  path: string
  /** Current HEAD SHA, when resolvable. */
  headSha?: string
  /** The last-reviewed SHA, when the repo has been reviewed before. */
  reviewedSha?: string
  /** Commits in `reviewedSha..HEAD` (0 for a first-seen or up-to-date repo). */
  newCommits: number
  /** What to do: baseline a first-seen repo, review new commits, skip an up-to-date one, or an error. */
  action: MaintenanceAction
  /** Context for an `error` or an unusual `review` (e.g. rewritten history). */
  note?: string
}

/**
 * Assess one repo: resolve HEAD, read its review state, and count the commits since
 * the last review. A never-reviewed repo is `baseline` (we record HEAD without
 * reviewing history retroactively); an unchanged repo is `skip`; new commits are
 * `review`. A non-repo / missing git is `error` (skipped, never throws). A reviewed
 * SHA git no longer knows (rebased away) falls back to `review`.
 */
export async function assessRepo(
  path: string,
  git: GitRunner = nodeGitRunner(),
  fs: MaintenanceFs = nodeMaintenanceFs(),
): Promise<RepoReview> {
  let headSha: string
  try {
    headSha = (await git(['rev-parse', 'HEAD'], path)).trim()
  } catch {
    return { path, newCommits: 0, action: 'error', note: 'not a git repo, or it has no commits' }
  }

  const { reviewedSha } = await readMaintenanceState(path, fs)
  if (!reviewedSha) return { path, headSha, newCommits: 0, action: 'baseline' }
  if (reviewedSha === headSha) return { path, headSha, reviewedSha, newCommits: 0, action: 'skip' }

  try {
    const count = Number.parseInt((await git(['rev-list', '--count', `${reviewedSha}..HEAD`], path)).trim(), 10)
    const newCommits = Number.isFinite(count) ? count : 0
    return { path, headSha, reviewedSha, newCommits, action: newCommits > 0 ? 'review' : 'skip' }
  } catch {
    // The reviewed commit is unknown to git (history was rewritten): re-review to be safe.
    return { path, headSha, reviewedSha, newCommits: 0, action: 'review', note: 'reviewed commit not found (history changed); re-reviewing' }
  }
}

/** Assess every registered repo, tagging each review with its registry id. */
export async function planMaintenanceSweep(
  repos: readonly { id?: string; path: string }[],
  git: GitRunner = nodeGitRunner(),
  fs: MaintenanceFs = nodeMaintenanceFs(),
): Promise<RepoReview[]> {
  return Promise.all(repos.map(async repo => ({ ...(await assessRepo(repo.path, git, fs)), ...(repo.id ? { id: repo.id } : {}) })))
}

/** The tally a sweep returns. */
export interface SweepSummary {
  reviewed: number
  baselined: number
  skipped: number
  failed: number
  /** Repos not reached because `maxRepos` was hit. */
  pending: number
}

/** Injected effects for {@link maintainSweep}, so the orchestration is testable off disk/process. */
export interface SweepDeps {
  /** Run the maintenance loop on a repo; resolves true on success. */
  run(review: RepoReview): Promise<boolean>
  /** Persist a repo's review state (called after a baseline or a successful review). */
  record(path: string, state: MaintenanceState): Promise<void>
  /** Progress line. */
  log(message: string): void
  /** ISO timestamp for a recorded review (injected so runs are deterministic in tests). */
  now(): string
  /** Stop after reviewing this many repos in one sweep (baselines/skips don't count). */
  maxRepos?: number
}

/**
 * Orchestrate a sweep over pre-assessed reviews: baseline first-seen repos (record
 * HEAD, no run), skip up-to-date ones, and run the maintenance loop on the rest —
 * recording the reviewed SHA only when the run succeeds, so a failure is retried next
 * sweep. Honors `maxRepos`; the remainder is reported as `pending`.
 */
export async function maintainSweep(reviews: readonly RepoReview[], deps: SweepDeps): Promise<SweepSummary> {
  const summary: SweepSummary = { reviewed: 0, baselined: 0, skipped: 0, failed: 0, pending: 0 }
  const limit = deps.maxRepos ?? Infinity
  for (const review of reviews) {
    if (review.action === 'skip') {
      summary.skipped++
      continue
    }
    if (review.action === 'error') {
      summary.failed++
      deps.log(`✗ ${review.path}: ${review.note ?? 'could not assess'}`)
      continue
    }
    if (review.action === 'baseline') {
      if (review.headSha) await deps.record(review.path, { reviewedSha: review.headSha, reviewedAt: deps.now() })
      summary.baselined++
      deps.log(`◆ baselined ${review.path} at ${short(review.headSha)}`)
      continue
    }
    // action === 'review'
    if (summary.reviewed >= limit) {
      summary.pending++
      continue
    }
    deps.log(`▶ maintaining ${review.path} (${review.newCommits} new commit${review.newCommits === 1 ? '' : 's'})…`)
    const ok = await deps.run(review)
    if (ok && review.headSha) {
      await deps.record(review.path, { reviewedSha: review.headSha, reviewedAt: deps.now() })
      summary.reviewed++
      deps.log(`✓ ${review.path} reviewed`)
    } else {
      summary.failed++
      deps.log(`✗ ${review.path} maintenance run failed; will retry next sweep`)
    }
  }
  return summary
}

/** Short SHA for logs. */
export function short(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : '(unknown)'
}
