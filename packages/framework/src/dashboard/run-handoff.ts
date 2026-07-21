import { nodeGitRunner, type GitRunner } from '../project.js'
import { ghPrView, nodeGhRunner, type GhRunner, type LinkedPr, type BranchPrLookup } from './gh.js'
import { parseNumstat } from './file-diff.js'

// What a finished session produced, and what is left to do with it (#799).
//
// Everything up to "the agent is done" was covered; the handoff back to the human was not. A
// clean run archives its history, commits what it was holding, removes its worktree and leaves
// the work on a branch. Nothing pushed, nothing opened, and the dashboard showed none of it.
//
// The read is deliberately *branch*-addressed, not worktree-addressed: the common end state has
// no worktree left, so a checkout-based read (`onRunWorktree`) falls back to the project root and
// reports the project's own branch as if it were the session's. Here the branch is the subject and
// the project repo is only where it is read from, so a finished session reads the same whether or
// not its checkout still exists.
//
// Forgiving throughout: a project that is not a git repo, has no remote, or has no `gh` yields a
// handoff with less in it, never an error.

/** One commit a session put on its branch. */
export interface HandoffCommit {
  sha: string
  /** Short sha, for display. */
  short: string
  subject: string
}

/** One file the session changed, against the branch point. */
export interface HandoffFile {
  path: string
  insertions: number
  deletions: number
  /** True for a binary file, where line counts are meaningless. */
  binary: boolean
}

/** What a finished session produced and what can still be done with it. */
export interface RunHandoff {
  /** The branch the work is on. */
  branch: string
  /** The branch still exists in the repo (a deleted or never-created one does not). */
  exists: boolean
  /** What the branch is measured against (the repo's default branch), when one was found. */
  base?: string
  commits: HandoffCommit[]
  files: HandoffFile[]
  insertions: number
  deletions: number
  /**
   * The session produced nothing to hand off: the branch exists but carries no commit the base
   * does not already have. Said out loud, rather than shown as an empty branch.
   */
  empty: boolean
  /** The repo has a remote to push to at all. */
  hasRemote: boolean
  /** The branch is on the remote and the remote is at the same commit. */
  pushed: boolean
  /** The branch is already merged into the base. */
  merged: boolean
  /** The PR opened for this branch, when there is one. */
  pr?: LinkedPr
}

/** Injectable seams so the reader is unit-testable off disk. */
export interface RunHandoffDeps {
  git?: GitRunner
  pr?: BranchPrLookup
}

/**
 * The branch a run's work is on.
 *
 * Prefers what was recorded while the worktree existed (#799), because the #326 prompt lets the
 * agent name its own branch, which makes both derivations below a guess. They stay as a fallback
 * for runs archived before the branch was recorded.
 */
export function runBranchFor(run: { id: string; branch?: string; sessionName?: string }): string {
  if (run.branch) return run.branch
  return run.sessionName ? `the-framework/${run.sessionName}` : `the-framework/run-${run.id}`
}

/** `git` that resolves to '' instead of rejecting, for reads where "no answer" is a fine answer. */
function soft(git: GitRunner, cwd: string): (args: string[]) => Promise<string> {
  return args => git(args, cwd).catch(() => '')
}

/** The repo's default branch: what the remote points HEAD at, else the first local conventional one. */
async function detectBase(run: (args: string[]) => Promise<string>): Promise<string | undefined> {
  const head = (await run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
  if (head) return head
  for (const name of ['main', 'master']) {
    if ((await run(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).trim()) return name
  }
  return undefined
}

/** A subject can hold anything, so the fields are unit-separated rather than space-split. */
const SEP = String.fromCharCode(31)

/** Parse `git log --format=%H%x1f%s`. */
function parseCommits(out: string): HandoffCommit[] {
  return out
    .split('\n')
    .filter(line => line.includes(SEP))
    .map(line => {
      const [sha = '', subject = ''] = line.split(SEP)
      return { sha, short: sha.slice(0, 7), subject }
    })
}

/** `git diff --numstat` as {@link HandoffFile}s, via the shared parser in file-diff.ts. */
function parseHandoffFiles(out: string): HandoffFile[] {
  return parseNumstat(out).map(({ path, added, removed, binary }) => ({ path, insertions: added, deletions: removed, binary }))
}

/**
 * Read what a finished session left behind, from the project repo, for `branch`.
 *
 * Returns undefined only when `cwd` is not a git repo at all. A branch that no longer exists
 * still returns a handoff (with `exists: false`), because "that branch is gone" is itself the
 * answer the dashboard needs to show.
 */
export async function readRunHandoff(
  cwd: string,
  branch: string,
  deps: RunHandoffDeps = {},
): Promise<RunHandoff | undefined> {
  const git = deps.git ?? nodeGitRunner()
  const run = soft(git, cwd)

  // Not a repo (or git is unusable): nothing here is answerable.
  if (!(await git(['rev-parse', '--git-dir'], cwd).then(() => true).catch(() => false))) return undefined

  const tip = (await run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).trim()
  const hasRemote = (await run(['remote'])).trim().length > 0
  if (!tip) {
    return { branch, exists: false, commits: [], files: [], insertions: 0, deletions: 0, empty: true, hasRemote, pushed: false, merged: false }
  }

  const base = await detectBase(run)
  // Compare against the branch point, not the base tip, so commits that merely landed on the base
  // after this session started are not read as the session's work.
  const range = base ? `${base}...${branch}` : undefined

  const [commitsOut, numstatOut, remoteTip, mergedOut] = await Promise.all([
    range ? run(['log', '--format=%H%x1f%s', range]) : Promise.resolve(''),
    range ? run(['diff', '--numstat', range]) : Promise.resolve(''),
    hasRemote ? run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]) : Promise.resolve(''),
    base ? run(['branch', '--list', '--merged', base, branch]) : Promise.resolve(''),
  ])

  const commits = parseCommits(commitsOut)
  const files = parseHandoffFiles(numstatOut)
  const pr = await (deps.pr ?? ghPrView)(cwd, branch).catch(() => undefined)

  return {
    branch,
    exists: true,
    ...(base ? { base } : {}),
    commits,
    files,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    // A session that changed nothing is a real outcome, not an error: it gets said, not shown as
    // an empty branch with buttons that would push nothing.
    empty: commits.length === 0,
    hasRemote,
    pushed: remoteTip.trim() === tip,
    merged: mergedOut.trim().length > 0,
    ...(pr ? { pr } : {}),
  }
}

/** The outcome of a handoff action, in the `{ ok }` shape the dashboard's `useAction` understands. */
export type HandoffResult = { ok: true; url?: string } | { ok: false; error: string }

/**
 * Push a finished session's branch to `origin`.
 *
 * Deliberately a click, not something teardown does on its own: pushing publishes the agent's
 * work under the user's name to a shared remote, and that is the user's call to make, not a
 * side effect of a run ending. The dashboard offers it; the human takes it.
 */
export async function pushRunBranch(
  cwd: string,
  branch: string,
  git: GitRunner = nodeGitRunner(),
): Promise<HandoffResult> {
  try {
    await git(['push', '--set-upstream', 'origin', branch], cwd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: gitReason(err) }
  }
}

/**
 * The line of a failed git invocation worth showing.
 *
 * `execFile` rejects with "Command failed: git push ..." and buries git's own `fatal:` line
 * further down, which in a one-line panel means the user reads the command back instead of the
 * reason it failed.
 */
export function gitReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const lines = message.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.find(line => /^(fatal|error|remote):/i.test(line)) ?? lines[0] ?? 'git failed'
}

/** What to put on the PR. */
export interface PullRequestDraft {
  title: string
  body: string
  base?: string
}

/**
 * Open a PR for a finished session's branch, pushing it first when the remote does not have it.
 *
 * Opened ready rather than draft on purpose: the interventions queue (#632) lists open *non-draft*
 * PRs as "needs you", so a draft would open the loop back into the dashboard and then not appear
 * in it. The point of the handoff is that the work lands somewhere the human will see it again.
 */
export async function openRunPullRequest(
  cwd: string,
  branch: string,
  draft: PullRequestDraft,
  deps: { git?: GitRunner; gh?: GhRunner } = {},
): Promise<HandoffResult> {
  const git = deps.git ?? nodeGitRunner()
  const gh = deps.gh ?? nodeGhRunner()
  // gh refuses to open a PR for a branch the remote has never seen, so the push is part of the
  // action rather than a thing the user has to remember to do first.
  const pushed = await pushRunBranch(cwd, branch, git)
  if (!pushed.ok) return pushed
  try {
    const args = ['pr', 'create', '--head', branch, '--title', draft.title, '--body', draft.body]
    if (draft.base) args.push('--base', draft.base)
    const out = (await gh(args, cwd)).trim()
    // gh prints the new PR's URL as its last line.
    const url = out.split('\n').filter(Boolean).at(-1)
    return url ? { ok: true, url } : { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
