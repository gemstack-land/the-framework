import { nodeGitRunner, type GitRunner } from '../project.js'

// The project panel's git status (#491, part of #488): the active branch, whether the tree is
// dirty, and the linked PR. Branch + dirty are a local git read; the PR is a best-effort gh
// lookup that simply degrades to nothing when gh is missing/unauthed or there is no PR. Safe
// anywhere — the relay has no local checkout, so it resolves to nothing there.

/** The PR opened for the current branch, when there is one. */
export interface LinkedPr {
  number: number
  url: string
  /** OPEN / MERGED / CLOSED (as gh reports it). */
  state: string
  title: string
}

/** A project's git status for the panel. */
export interface GitStatus {
  branch: string
  /** Uncommitted changes present. */
  dirty: boolean
  pr?: LinkedPr
}

/** Best-effort linked-PR lookup for the checkout's current branch. */
export type PrLookup = (cwd: string) => Promise<LinkedPr | undefined>

/** A {@link PrLookup} via the `gh` CLI; resolves undefined when gh is missing/unauthed or there is no PR. */
export function nodeGhPrLookup(): PrLookup {
  return cwd =>
    new Promise(resolve => {
      void import('node:child_process').then(({ execFile }) => {
        execFile('gh', ['pr', 'view', '--json', 'number,url,state,title'], { cwd, timeout: 8_000 }, (err, stdout) => {
          if (err) return resolve(undefined)
          try {
            const pr = JSON.parse(String(stdout)) as LinkedPr
            resolve({ number: pr.number, url: pr.url, state: pr.state, title: pr.title })
          } catch {
            resolve(undefined)
          }
        })
      })
    })
}

/** Injectable seams so {@link readGitStatus} is unit-testable off disk. */
export interface GitStatusDeps {
  git?: GitRunner
  pr?: PrLookup
}

/**
 * Read a project's git status: the current branch and dirty flag (from git), plus the linked
 * PR (best-effort). Returns undefined when the path is not a git repo. Forgiving — a failed
 * `git status` reads as clean, and a failed PR lookup simply omits the PR.
 */
export async function readGitStatus(cwd: string, deps: GitStatusDeps = {}): Promise<GitStatus | undefined> {
  const git = deps.git ?? nodeGitRunner()
  let branch: string
  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
  } catch {
    return undefined // not a git repo (or git failed)
  }
  const dirty = (await git(['status', '--porcelain'], cwd).catch(() => '')).trim().length > 0
  const pr = await (deps.pr ?? nodeGhPrLookup())(cwd).catch(() => undefined)
  return { branch, dirty, ...(pr ? { pr } : {}) }
}
