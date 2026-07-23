import { nodeGitRunner, type GitRunner } from '../project.js'

// Per-file git status for the panel's file tree (#492): the working-tree state of each changed
// file, so the tree can dot untracked/modified/deleted entries. A single `git status --porcelain`
// read, mapped to repo-relative path -> state. Forgiving: a non-repo / failed git yields `{}`.

/** The tree's per-file git state (matches the animate-ui Files `gitStatus`). */
export type FileGitStatus = 'untracked' | 'modified' | 'deleted'

/** Strip git's surrounding quotes from a path with special chars (basic; leaves escapes as-is). */
function unquotePath(path: string): string {
  return path.length >= 2 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
}

/**
 * Read each changed file's status from `git status --porcelain`, keyed by repo-relative path.
 * `??` is untracked, a `D` in either column is deleted, anything else (M/A/R/C…) reads as
 * modified. Renames map to the new path. Returns `{}` when the path is not a git repo.
 */
export async function readFileStatuses(cwd: string, git: GitRunner = nodeGitRunner()): Promise<Record<string, FileGitStatus>> {
  const out = await git(['status', '--porcelain'], cwd).catch(() => '')
  const map: Record<string, FileGitStatus> = {}
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4) // a rename: dot the new path
    path = unquotePath(path)
    if (!path) continue
    map[path] = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : 'modified'
  }
  return map
}
