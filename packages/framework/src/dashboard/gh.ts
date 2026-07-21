import { cliRunner, type CliRunner } from '../cli-exec.js'

/**
 * The `gh` CLI, in one place: the two JSON reads the dashboard makes and the runner its write
 * actions use.
 *
 * There were four separate `gh` adapters across three modules. Three were reads that each
 * hand-rolled `execFile` + `JSON.parse` + a swallowed failure and each spelled the 8s timeout
 * again, and two of those differed only in whether a branch positional was passed; the fourth was
 * a generic runner for the write actions, which rejects with stderr and waits longer.
 */

/** Runs `gh`, resolving stdout and rejecting with the CLI's own stderr on failure. */
export type GhRunner = CliRunner

/**
 * A {@link GhRunner} for the write actions (push, open a PR). Longer timeout than a read: these
 * talk to the network and to git, and the user is waiting on a button they pressed.
 */
export function nodeGhRunner(): GhRunner {
  return cliRunner({ bin: 'gh', timeoutMs: 60_000, preferStderr: true })
}

/**
 * Reads are capped short and never surface an error: every caller is a panel that renders
 * whatever it got, and "gh is not installed" must cost a page load nothing.
 */
const readGh = cliRunner({ bin: 'gh', timeoutMs: 8_000 })

/** A forgiving `gh --json` read: resolves `empty` when gh is missing/unauthed, or its output is not JSON. */
export async function ghJson<T>(args: string[], cwd: string, empty: T): Promise<T> {
  try {
    return JSON.parse(await readGh(args, cwd)) as T
  } catch {
    return empty
  }
}

/** The PR opened for a branch, when there is one. */
export interface LinkedPr {
  number: number
  url: string
  /** OPEN / MERGED / CLOSED (as gh reports it). */
  state: string
  title: string
}

/**
 * A best-effort PR lookup, for a named branch or for the checkout's current branch. One type for
 * both: the named-branch form is the general one, and "the current branch" is just omitting it.
 */
export type PrLookup = (cwd: string, branch?: string) => Promise<LinkedPr | undefined>

/**
 * The branch-addressed form, for a caller that always names one (#799): a finished session's
 * worktree may be gone, so "the current branch" would silently be the project's, not the
 * session's. Narrower than {@link PrLookup} on purpose, so that invariant is in the type.
 */
export type BranchPrLookup = (cwd: string, branch: string) => Promise<LinkedPr | undefined>

const PR_VIEW_FIELDS = 'number,url,state,title'

/**
 * The PR for `branch`, or for whatever branch `cwd` is on when none is named. Resolves undefined
 * when gh is missing/unauthed or there is no PR.
 *
 * The named-branch form is what a finished session needs (#799): its worktree may be gone, so the
 * checkout's current branch is the project's, not the session's. The fields are copied out rather
 * than passed through, so a future `--json` addition cannot leak into what callers store.
 */
export async function ghPrView(cwd: string, branch?: string): Promise<LinkedPr | undefined> {
  const args = ['pr', 'view', ...(branch ? [branch] : []), '--json', PR_VIEW_FIELDS]
  const pr = await ghJson<LinkedPr | undefined>(args, cwd, undefined)
  return pr ? { number: pr.number, url: pr.url, state: pr.state, title: pr.title } : undefined
}

/** An open PR on the interventions queue (#632). */
export interface OpenPr {
  number: number
  title: string
  url: string
  /** Draft PRs are not ready for review, so they are left off the queue. */
  isDraft: boolean
  createdAt?: string
}

/** A checkout's open PRs; resolves `[]` when there is no remote or gh is unavailable. */
export async function ghPrList(cwd: string): Promise<OpenPr[]> {
  const args = ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,isDraft,createdAt']
  return ghJson<OpenPr[]>(args, cwd, [])
}

/** Lists a checkout's open PRs; resolves `[]` when there is no remote / gh is unavailable. */
export type PrLister = (cwd: string) => Promise<OpenPr[]>
