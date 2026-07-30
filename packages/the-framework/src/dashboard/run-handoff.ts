import { nodeGitRunner, type GitRunner } from '../project.js'
import {
  cachedPrsForBranch,
  forgetBranchPrs,
  forgetPr,
  ghMergePr,
  ghPrsForBranch,
  nodeGhRunner,
  pickRunPr,
  type GhRunner,
  type LinkedPr,
  type BranchPrLookup,
} from './gh.js'
import type { Cached } from './cache.js'
import { parseNumstat } from './file-diff.js'
import { parsePorcelain } from './file-status.js'
import { errorMessage } from '../error-message.js'
import type { AutoHandoffSkip, AutoMergeOutcome, MergeWithheldReason } from '../events.js'
import { commitPendingWork, currentBranch, startedAtFromRunId, FRAMEWORK_DIR, type RunMeta } from '../store/index.js'

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
   * does not already have — or nothing beyond the framework's own bookkeeping (#1291), which is
   * committed for provenance, never as publishable work. Said out loud, rather than shown as an
   * empty branch.
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
  /**
   * The files the session changed and never committed, read from its own checkout (#1173).
   *
   * The agent is instructed to commit what it *found*, never what it *wrote*, so a settled session
   * can hold its whole output in an uncommitted tree. That work is not on the branch yet, so it is
   * not in {@link commits} and it does not make {@link empty} false. Paths rather than a count,
   * because a no-diff branch must *name* what is waiting instead of offering an Open PR that
   * GitHub can only refuse. Absent when the caller did not say which checkout the session worked
   * in — "nobody asked" and "asked, tree clean" are different answers.
   */
  pendingFiles?: string[]
}

/** Injectable seams so the reader is unit-testable off disk, plus the checkout the session worked in. */
export interface RunHandoffDeps {
  git?: GitRunner
  pr?: BranchPrLookup
  /**
   * The session's own checkout (#453), when it has one. The branch lives in the project repo and is
   * read from there; uncommitted work does not, it sits in the tree the agent actually edited.
   */
  checkout?: string
  /**
   * When the run started (ISO), so the PR lookup can tell the run's own PR from an earlier run's
   * on the same branch name (#1251). Without it, only an open PR is trusted.
   */
  since?: string
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
 * The branch's PR as it applies to *this* run: the injected seam when the caller gave one, else
 * the cached history filtered through {@link pickRunPr} with the run's start time (#1251).
 */
async function lookupRunPr(cwd: string, branch: string, deps: RunHandoffDeps): Promise<Cached<LinkedPr | undefined>> {
  if (deps.pr) return { value: await deps.pr(cwd, branch).catch(() => undefined), pending: false }
  const prs = await cachedPrsForBranch(cwd, branch).catch(() => ({ value: undefined, pending: false }))
  return { value: prs.value ? pickRunPr(prs.value, deps.since) : undefined, pending: prs.pending }
}

/** What {@link resolveRunPr} needs to know about a run: structurally satisfied by {@link RunMeta}. */
export interface RunPrRun {
  id: string
  startedAt?: string
  branch?: string
  sessionName?: string
}

/** The injectable lookup seam for {@link resolveRunPr}: a branch's cached PR history. */
export type BranchPrsLookup = (cwd: string, branch: string) => Promise<Cached<LinkedPr[]>>

/**
 * The PR that belongs to a run, tried across every branch name the run may have worked under
 * (#1251/#1255): the recorded branch, the session-name branch, then the run-id branch.
 *
 * The ladder is what makes a hands-off web run resolvable: its local worktree is torn down (or
 * never existed), its meta may carry only a session name whose branch is a reused pin, but the
 * cloud session pushed the run-id branch, which no other run can ever have. Each candidate is
 * filtered through {@link pickRunPr} with the run's start time, so a predecessor's PR on a shared
 * branch name is never the answer. `pending` only when nothing was found and a lookup is still
 * running, so the caller can ask again rather than render "no PR".
 */
export async function resolveRunPr(
  cwd: string,
  run: RunPrRun,
  prs: BranchPrsLookup = cachedPrsForBranch,
): Promise<Cached<LinkedPr | undefined>> {
  const since = run.startedAt ?? startedAtFromRunId(run.id)
  const candidates = [
    ...new Set([
      ...(run.branch ? [run.branch] : []),
      ...(run.sessionName ? [`${SESSION_BRANCH_PREFIX}${run.sessionName}`] : []),
      `${SESSION_BRANCH_PREFIX}run-${run.id}`,
    ]),
  ]
  let pending = false
  for (const branch of candidates) {
    const read = await prs(cwd, branch).catch((): Cached<LinkedPr[]> => ({ value: undefined, pending: false }))
    if (read.pending) pending = true
    const pr = read.value ? pickRunPr(read.value, since) : undefined
    if (pr) return { value: pr, pending: false }
  }
  return { value: undefined, pending }
}

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

/** The framework's own paper trail (#1291): conversation records, LOGS, session archives. */
function isBookkeepingPath(path: string): boolean {
  return path === FRAMEWORK_DIR || path.startsWith(`${FRAMEWORK_DIR}/`)
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
  const pending = await countPendingWork(git, deps.checkout)
  if (!tip) {
    // The branch being gone locally does not mean the work is: a hands-off web run pushes its
    // branch and opens its PR remotely, and a merged branch gets deleted. The PR is a remote
    // question, so it is still answerable — and it is the one thing left worth showing (#1255).
    const pr = await lookupRunPr(cwd, branch, deps)
    return {
      branch,
      exists: false,
      commits: [],
      files: [],
      insertions: 0,
      deletions: 0,
      empty: true,
      hasRemote,
      pushed: false,
      merged: false,
      ...(pr.value ? { pr: pr.value } : {}),
      ...(pr.pending ? { prPending: true } : {}),
      ...pending,
    }
  }

  const base = await detectBase(run)
  // Two ranges, because git's two spellings mean opposite things here and only one is right for
  // each question (#1164/#1173).
  //
  // `base..branch` is the branch's OWN commits, which is what "what did this session produce"
  // asks. `base...branch` in `git log` is the SYMMETRIC difference, so it also lists commits that
  // are only on the base — exactly the thing the comment below says not to count. A session whose
  // work is already merged then reported commits it did not make, `empty` stayed false, and the
  // dashboard offered an Open PR that GitHub refuses with "No commits between main and <branch>".
  //
  // For the diff the three-dot form IS the right one: it is the change since the branch point,
  // rather than a comparison against a base that has moved on since.
  const logRange = base ? `${base}..${branch}` : undefined
  const diffRange = base ? `${base}...${branch}` : undefined

  const [commitsOut, numstatOut, remoteTip, mergedOut] = await Promise.all([
    logRange ? run(['log', '--format=%H%x1f%s', logRange]) : Promise.resolve(''),
    diffRange ? run(['diff', '--numstat', diffRange]) : Promise.resolve(''),
    hasRemote ? run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]) : Promise.resolve(''),
    base ? run(['branch', '--list', '--merged', base, branch]) : Promise.resolve(''),
  ])

  const commits = parseCommits(commitsOut)
  const files = parseHandoffFiles(numstatOut)
  // Read through the cache and allowed to arrive late (#1028): the commits, the files and
  // whether the branch is pushed are all local git, and none of them should wait on `gh`.
  const pr = await lookupRunPr(cwd, branch, deps)

  return {
    branch,
    exists: true,
    ...(base ? { base } : {}),
    commits,
    files,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    // A session that changed nothing is a real outcome, not an error: it gets said, not shown as
    // an empty branch with buttons that would push nothing. Bookkeeping-only counts as nothing
    // (#1291): every run's branch carries the framework's own records — the #326 pre-work commit
    // sweeps in the conversation file the daemon just wrote — and publishing those alone produced
    // junk PRs of pure paper trail. The files decide, not the commits: a branch of bookkeeping
    // sweeps has commits and still nothing to hand off.
    empty: commits.length === 0 || files.every(file => isBookkeepingPath(file.path)),
    hasRemote,
    pushed: remoteTip.trim() === tip,
    merged: mergedOut.trim().length > 0,
    ...(pr.value ? { pr: pr.value } : {}),
    ...(pr.pending ? { prPending: true } : {}),
    ...pending,
  }
}

/**
 * The files the session left uncommitted in its own checkout, as a spreadable field.
 *
 * Absent rather than `[]` when no checkout was given (or git could not answer): "nobody asked" and
 * "asked, nothing pending" are different answers, and only the second one may be shown as a clean
 * tree.
 */
async function countPendingWork(git: GitRunner, checkout: string | undefined): Promise<{ pendingFiles?: string[] }> {
  if (!checkout) return {}
  const status = await git(['status', '--porcelain'], checkout).catch(() => undefined)
  if (status === undefined) return {}
  return { pendingFiles: parsePorcelain(status).map(entry => entry.path) }
}

/**
 * Commit what a session left uncommitted, so what it did is what gets handed off (#1173).
 *
 * The automatic handoff commits the session's leftovers on the run's way out, but that happens
 * when the run process exits, and the finishing step is offered as soon as the agent settles
 * (#1178), which for a session left open for another turn is much earlier. Pressing the button is
 * the same instruction given by hand, so it sweeps the same leftovers into what it publishes. The
 * button only shows for a branch that already carries commits (#1173): a no-diff branch names its
 * uncommitted work instead of offering a step, so this never turns "nothing committed" into a PR
 * by itself.
 *
 * Two guards, because both failure modes end with the user's own work committed for them: the
 * checkout has to be the session's own (#453) rather than the project root that `resolveRunCheckout`
 * falls back to once a worktree is gone, and it has to be sitting on the session's branch.
 *
 * Returns whether the handoff may go ahead: true when there was nothing to do, when the guards say
 * this is not ours to commit, or when the commit succeeded.
 */
export async function commitSessionWork(
  checkout: string,
  projectCwd: string,
  branch: string,
  git: GitRunner = nodeGitRunner(),
): Promise<boolean> {
  if (checkout === projectCwd) return true
  if ((await currentBranch(checkout, git)) !== branch) return true
  return commitPendingWork(checkout, git)
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
    // open one for the next minute (#1028). Both caches: the single-PR view and the history.
    forgetPr(cwd, branch)
    forgetBranchPrs(cwd, branch)
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
  const handoff = await readRunHandoff(cwd, branch, { since: run.startedAt }).catch(() => undefined)
  // The run's PR first, even when its branch is gone locally: a hands-off web run's branch only
  // ever existed on the remote, and its PR is the answer the button exists to give (#1255).
  if (handoff?.pr) return { ok: true, url: handoff.pr.url }
  if (handoff && !handoff.exists) return { ok: false, error: `branch ${branch} no longer exists` }
  // Refuse rather than open an empty PR: a session that changed nothing has nothing to hand off.
  if (handoff?.empty) return { ok: false, error: 'this session produced no commits to open a PR for' }
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
  /**
   * Merge the PR once it is opened (#1216). Absent = off, unlike the pair above: landing work on
   * the default branch is not something to arm by default. No action-bar checkbox mutates it —
   * it comes settled off the run's config.
   */
  merge?: boolean
}

/** Both halves armed — the default a session starts from. */
export const ARMED_HANDOFF: HandoffIntent = { push: true, pr: true }

/**
 * Whether an armed merge may actually run (#1363), and if not, why.
 *
 * The rule settled on #1390: config *arms* the merge, the agent *authorizes* it. Landing on the
 * default branch unattended takes (a) the agent having declared the session done via
 * setReadyForMerge() — the same signal the on-before-mergeable step requires — and (b) the
 * framework not already knowing of work pending in this session (its own TODO file; never the
 * global queue, which is decoupled from sessions). A withheld merge is not a failed handoff:
 * push and PR go ahead, the PR just opens as a draft for a human.
 *
 * (b) is a temporary safety belt: the agent's word should ultimately be enough. Deleting it means
 * deleting `sessionTodoOpen` here and `sessionTodoPending` in todo-loop.ts.
 */
export function withheldMerge(deps: { readyForMerge: boolean; sessionTodoOpen: boolean }): MergeWithheldReason | undefined {
  if (!deps.readyForMerge) return 'not-ready-for-merge'
  if (deps.sessionTodoOpen) return 'session-todo-open'
  return undefined
}

/**
 * What auto-handoff did, so the run can say it as an event (#835).
 *
 * A dashboard-started run is spawned with `stdio: 'ignore'`, so anything printed here reaches
 * nobody: the outcome has to travel as an event or it does not travel at all. Skips are reported
 * for the same reason a skipped on-before-mergeable is — silence reads as "it ran and did nothing".
 */
export type AutoHandoffOutcome =
  | { outcome: 'skipped'; reason: AutoHandoffSkip; merge?: AutoMergeOutcome }
  | { outcome: 'done'; pushed: boolean; url?: string; merge?: AutoMergeOutcome }
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
  const since = run.startedAt ?? startedAtFromRunId(run.id)
  const { gh, ...readDeps } = deps
  // The UNcached PR lookup, deliberately. The dashboard's cache answers `prPending` rather than
  // yes-or-no (#1028), which is right for a panel repainting every 15s and wrong here: "not known
  // yet" would read as "no PR" and this would open a second one. Proved against a real remote —
  // only `gh` refusing the duplicate stopped it. This runs once, at the end of a session, so it
  // can afford to wait for a real answer. Filtered by the run's start time (#1251): a merged PR
  // from an earlier run on the same branch name must not stop this run from opening its own.
  const runPr: BranchPrLookup = async (c, b) => pickRunPr(await ghPrsForBranch(c, b), since)
  const state = await readRunHandoff(cwd, branch, { pr: runPr, ...readDeps }).catch(() => undefined)
  if (!state || !state.exists) return { outcome: 'skipped', reason: 'branch-gone' }
  if (state.empty) return { outcome: 'skipped', reason: 'no-commits' }
  if (!state.hasRemote) return { outcome: 'skipped', reason: 'no-remote' }
  // A PR already covers both halves: it means the branch is published and the human has a place
  // to answer. Opening a second one is the one mistake this must never make. An armed merge
  // (#1216) still applies to the open PR — this is a rerun or a restart finding the PR its
  // predecessor opened, and the merge is the half that has not happened yet.
  if (state.pr) {
    if (intent.merge && state.pr.state === 'OPEN') {
      return { outcome: 'skipped', reason: 'already-open', merge: await ghMergePr(cwd, state.pr.number, gh) }
    }
    return { outcome: 'skipped', reason: 'already-open' }
  }

  if (intent.pr) {
    // `openRunPullRequest` pushes first, so the PR half subsumes the push half.
    const opened = await openRunPullRequest(
      cwd,
      branch,
      {
        title: run.sessionName ?? run.intent?.split('\n')[0]?.slice(0, 72) ?? `Session ${run.id}`,
        body: sessionPrBody(run),
        // GitHub refuses to merge or auto-merge a draft, so an armed merge (#1216) opens the PR
        // ready: its review happened on the queue before the run, which is the same reason the
        // merge is armed at all. Draft stays the default for PRs a human is meant to look at.
        draft: !intent.merge,
        ...(state.base ? { base: state.base } : {}),
      },
      { ...(readDeps.git ? { git: readDeps.git } : {}), ...(gh ? { gh } : {}) },
    )
    if (!opened.ok) return { outcome: 'failed', step: 'pr', error: opened.error }
    // The merge half (#1216), only after the PR half succeeded. The number comes off the URL gh
    // just printed; the lookup is the fallback for a gh that answered without one. Failing to
    // resolve a number is a reported merge failure, never a failed handoff — the PR is there.
    const merge = intent.merge
      ? await (async (): Promise<AutoMergeOutcome> => {
          const lookup = readDeps.pr ?? runPr
          const number = prNumberFromUrl(opened.url) ?? (await lookup(cwd, branch).catch(() => undefined))?.number
          return number !== undefined
            ? ghMergePr(cwd, number, gh)
            : { outcome: 'failed', error: 'could not resolve the PR number to merge' }
        })()
      : undefined
    return { outcome: 'done', pushed: true, ...(opened.url ? { url: opened.url } : {}), ...(merge ? { merge } : {}) }
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
export type HandoffRun = Pick<RunMeta, 'id' | 'branch' | 'sessionName' | 'intent'> & Partial<Pick<RunMeta, 'startedAt'>>

/** The PR number out of the URL `gh pr create` prints, e.g. `…/pull/123` (#1216). */
function prNumberFromUrl(url: string | undefined): number | undefined {
  const match = url?.match(/\/pull\/(\d+)(?:$|[/?#])/)
  return match ? Number(match[1]) : undefined
}

/** The PR body: what was asked for, and which session did it. */
function sessionPrBody(run: HandoffRun): string {
  const lines: string[] = []
  if (run.intent) lines.push(run.intent.trim(), '')
  lines.push(`Opened from The Framework session \`${run.sessionName ?? run.id}\`.`)
  return lines.join('\n')
}
