import { nodeGitRunner, type GitRunner } from '../project.js'
import { cachedPrView, forgetPr, ghPrView, nodeGhRunner, type GhRunner, type LinkedPr, type BranchPrLookup } from './gh.js'
import { parseNumstat } from './file-diff.js'
import { errorMessage } from '../error-message.js'
import type { AutoHandoffSkip } from '../events.js'
import type { RunMeta } from '../store/index.js'

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
  /** The PR is not known yet, rather than absent (#1028): the lookup is still running. */
  prPending?: boolean
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
  return run.sessionName ? `${SESSION_BRANCH_PREFIX}${run.sessionName}` : `${SESSION_BRANCH_PREFIX}run-${run.id}`
}

/** What every branch a session creates for itself is named under. */
export const SESSION_BRANCH_PREFIX = 'the-framework/'

/**
 * Whether a branch is one a session made, rather than one the user did.
 *
 * Only a naming convention, so it is a guess for the case #326 allows — the agent picking its own
 * branch name. Every caller uses it to decide how loudly to surface something, never to act.
 */
export function isSessionBranch(branch: string | undefined): boolean {
  return Boolean(branch?.startsWith(SESSION_BRANCH_PREFIX))
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
  // Read through the cache and allowed to arrive late (#1028): the commits, the files and
  // whether the branch is pushed are all local git, and none of them should wait on `gh`.
  const pr = deps.pr
    ? { value: await deps.pr(cwd, branch).catch(() => undefined), pending: false }
    : await cachedPrView(cwd, branch).catch(() => ({ value: undefined, pending: false }))

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
    ...(pr.value ? { pr: pr.value } : {}),
    ...(pr.pending ? { prPending: true } : {}),
  }
}

/** The outcome of a handoff action, in the `{ ok }` shape the dashboard's `useAction` understands. */
export type HandoffResult = { ok: true; url?: string } | { ok: false; error: string }

/**
 * Push a finished session's branch to `origin`.
 *
 * Publishing the agent's work under the user's name is the user's call, but since #1102 that call
 * is made once, up front, by a checkbox that is armed by default, rather than re-taken by hand at
 * the end of every session. The click is still here for a session that opted out, and it is what
 * a failed auto-push falls back to.
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
 * {@link RunHandoff.base} as a base a PR can actually be opened against.
 *
 * The field holds a git ref, because that is what every other use of it needs: `detectBase` reads
 * `refs/remotes/origin/HEAD`, so it is `origin/main`, and the log range and merged check are both
 * asking git a question about a remote-tracking ref. `gh pr create --base` is asking GitHub for a
 * *branch on the remote*, and rejects `origin/main` with "Base ref must be a branch".
 *
 * So the conversion belongs at the `gh` boundary rather than in the field. Stripping `origin/`
 * matches what the rest of this module already assumes: the remote is `origin` (`pushRunBranch`
 * pushes there, `detectBase` reads its HEAD).
 */
export function prBaseName(base: string): string {
  return base.startsWith('origin/') ? base.slice('origin/'.length) : base
}

/**
 * The line of a failed git invocation worth showing.
 *
 * `execFile` rejects with "Command failed: git push ..." and buries git's own `fatal:` line
 * further down, which in a one-line panel means the user reads the command back instead of the
 * reason it failed.
 */
export function gitReason(err: unknown): string {
  const message = errorMessage(err)
  const lines = message.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.find(line => /^(fatal|error|remote):/i.test(line)) ?? lines[0] ?? 'git failed'
}

/** What to put on the PR. */
export interface PullRequestDraft {
  title: string
  body: string
  base?: string
  /**
   * Open it as a GitHub draft (#1102). What auto-handoff uses: opening a PR by itself at the end
   * of every session should not put a review request in anyone's inbox.
   *
   * Safe to do only because the interventions queue was taught to keep listing a draft on a
   * session branch. Left off, a draft would be invisible in both places at once.
   */
  draft?: boolean
}

/**
 * Open a PR for a finished session's branch, pushing it first when the remote does not have it.
 *
 * The button opens it ready for review, because a PR a human asked for by name is asking for
 * review. {@link PullRequestDraft.draft} is the auto-handoff case, which is not.
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
    if (draft.base) args.push('--base', prBaseName(draft.base))
    if (draft.draft) args.push('--draft')
    const out = (await gh(args, cwd)).trim()
    // The branch has a PR now, so the cached "no PR" must go or the bar would keep offering to
    // open one for the next minute (#1028).
    forgetPr(cwd, branch)
    // gh prints the new PR's URL as its last line.
    const url = out.split('\n').filter(Boolean).at(-1)
    return url ? { ok: true, url } : { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * Open a PR for a finished session, deciding from what the run recorded which cases should not
 * open one. Reads the branch's handoff first: a branch that no longer exists, or a session that
 * changed nothing, is a clear error rather than an empty PR, and a branch that already has a PR
 * returns that one. Title is the session name (else the intent's first line, else the id); body
 * is the intent plus which session did it. This is the handoff decision the dashboard's
 * open-PR button offers; the RPC layer only resolves which run it is about.
 */
export async function openSessionPullRequest(
  cwd: string,
  run: RunMeta,
  options: { draft?: boolean } = {},
): Promise<HandoffResult> {
  const branch = runBranchFor(run)
  const handoff = await readRunHandoff(cwd, branch).catch(() => undefined)
  if (handoff && !handoff.exists) return { ok: false, error: `branch ${branch} no longer exists` }
  // Refuse rather than open an empty PR: a session that changed nothing has nothing to hand off.
  if (handoff?.empty) return { ok: false, error: 'this session produced no commits to open a PR for' }
  if (handoff?.pr) return { ok: true, url: handoff.pr.url }
  return openRunPullRequest(cwd, branch, {
    title: run.sessionName ?? run.intent?.split('\n')[0]?.slice(0, 72) ?? `Session ${run.id}`,
    body: sessionPrBody(run),
    ...(handoff?.base ? { base: handoff.base } : {}),
    ...(options.draft ? { draft: true } : {}),
  })
}

/**
 * What a session was left armed to do when it ends (#1102).
 *
 * Both start true. The point of the feature is that the common case costs nothing: a session that
 * is simply left alone puts its branch on the remote and opens a PR for it.
 */
export interface HandoffIntent {
  push: boolean
  pr: boolean
}

/** Both halves armed — the default a session starts from. */
export const ARMED_HANDOFF: HandoffIntent = { push: true, pr: true }

/**
 * What auto-handoff did, so the run can say it as an event (#835).
 *
 * A dashboard-started run is spawned with `stdio: 'ignore'`, so anything printed here reaches
 * nobody: the outcome has to travel as an event or it does not travel at all. Skips are reported
 * for the same reason a skipped on-before-mergeable is — silence reads as "it ran and did nothing".
 */
export type AutoHandoffOutcome =
  | { outcome: 'skipped'; reason: AutoHandoffSkip }
  | { outcome: 'done'; pushed: boolean; url?: string }
  | { outcome: 'failed'; step: 'push' | 'pr'; error: string }

/**
 * Do the end-of-session handoff a session was left armed for (#1102): push the branch, open a
 * draft PR for it, or both.
 *
 * Reads the branch first and refuses on everything that is not a clean hand-off — a branch that is
 * gone, a session that committed nothing, a repo with no remote, a branch that already has a PR.
 * Those are the cases where doing it anyway would produce a confusing artefact rather than help.
 *
 * The PR is a draft on purpose. Opening one by itself at the end of every session must not put a
 * review request in anyone's inbox, and the interventions queue keeps listing a session's draft
 * so the work still comes back to the human.
 */
export async function runAutoHandoff(
  cwd: string,
  run: HandoffRun,
  intent: HandoffIntent,
  deps: RunHandoffDeps & { gh?: GhRunner } = {},
): Promise<AutoHandoffOutcome> {
  if (!intent.push && !intent.pr) return { outcome: 'skipped', reason: 'not-armed' }
  const branch = runBranchFor(run)
  const { gh, ...readDeps } = deps
  // The UNcached PR lookup, deliberately. The dashboard's cache answers `prPending` rather than
  // yes-or-no (#1028), which is right for a panel repainting every 15s and wrong here: "not known
  // yet" would read as "no PR" and this would open a second one. Proved against a real remote —
  // only `gh` refusing the duplicate stopped it. This runs once, at the end of a session, so it
  // can afford to wait for a real answer.
  const state = await readRunHandoff(cwd, branch, { pr: ghPrView, ...readDeps }).catch(() => undefined)
  if (!state || !state.exists) return { outcome: 'skipped', reason: 'branch-gone' }
  if (state.empty) return { outcome: 'skipped', reason: 'no-commits' }
  if (!state.hasRemote) return { outcome: 'skipped', reason: 'no-remote' }
  // A PR already covers both halves: it means the branch is published and the human has a place
  // to answer. Opening a second one is the one mistake this must never make.
  if (state.pr) return { outcome: 'skipped', reason: 'already-open' }

  if (intent.pr) {
    // `openRunPullRequest` pushes first, so the PR half subsumes the push half.
    const opened = await openRunPullRequest(
      cwd,
      branch,
      {
        title: run.sessionName ?? run.intent?.split('\n')[0]?.slice(0, 72) ?? `Session ${run.id}`,
        body: sessionPrBody(run),
        draft: true,
        ...(state.base ? { base: state.base } : {}),
      },
      { ...(readDeps.git ? { git: readDeps.git } : {}), ...(gh ? { gh } : {}) },
    )
    if (!opened.ok) return { outcome: 'failed', step: 'pr', error: opened.error }
    return { outcome: 'done', pushed: true, ...(opened.url ? { url: opened.url } : {}) }
  }

  if (state.pushed) return { outcome: 'skipped', reason: 'already-pushed' }
  const pushed = await pushRunBranch(cwd, branch, readDeps.git)
  if (!pushed.ok) return { outcome: 'failed', step: 'push', error: pushed.error }
  return { outcome: 'done', pushed: true }
}

/**
 * The little a handoff needs to know about the run it is for: which branch, and what to say on
 * the PR. Narrower than {@link RunMeta} so the run process can call this before its meta is
 * final, and so a caller cannot quietly start depending on the rest of the run's state.
 */
export type HandoffRun = Pick<RunMeta, 'id' | 'branch' | 'sessionName' | 'intent'>

/** The PR body: what was asked for, and which session did it. */
function sessionPrBody(run: HandoffRun): string {
  const lines: string[] = []
  if (run.intent) lines.push(run.intent.trim(), '')
  lines.push(`Opened from The Framework session \`${run.sessionName ?? run.id}\`.`)
  return lines.join('\n')
}
