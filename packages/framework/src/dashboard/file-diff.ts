import { nodeGitRunner, type GitRunner } from '../project.js'
import type { FileGitStatus } from './file-status.js'
import { cutToPreview, readConfinedFile, safeRepoPath } from './file-read.js'

// `safeRepoPath` moved to file-read.js with #828, where the unchanged-file preview shares it.
// Re-exported so this stays the import site it has been.
export { safeRepoPath }

// One changed file's diff for the tree's hover card (#816) and the run view's Changes section
// (#817). The tree already says a file is M/U/D; this says what actually changed, without
// leaving the dashboard for `git diff`. Read against whatever checkout the caller resolved, so
// a session's hover shows its worktree and not the project root (#815).
//
// This is the first read that takes a caller-supplied path, so the guard is here rather than at
// the call site: `safeRepoPath` is the only way in, and every caller goes through it.

/** One file's diff, capped so a hover card can render it. */
export interface FileDiff {
  /** The repo-relative path asked for. */
  path: string
  status: FileGitStatus
  /** Unified diff body, hunks only (git's `diff --git` / index preamble is dropped). */
  patch: string
  added: number
  removed: number
  /** The patch hit the preview cap and was cut. */
  truncated: boolean
  /** Nothing textual to show (git reports a binary change, or the file is not UTF-8 text). */
  binary: boolean
}

/** One changed file in a session's Changes list (#817): what moved, and by how much. */
export interface FileChange {
  path: string
  status: FileGitStatus
  added: number
  removed: number
  /** Line counts are unavailable (a binary file, or an untracked one too large to count). */
  binary: boolean
}

/** Drop git's `diff --git` / `index` / `mode` preamble, keeping the `---`/`+++`/hunk body. */
function hunksOnly(patch: string): string {
  const lines = patch.split('\n')
  const start = lines.findIndex(line => line.startsWith('--- ') || line.startsWith('@@'))
  return (start === -1 ? [] : lines.slice(start)).join('\n').trimEnd()
}

/** Count the +/- lines of a unified patch, ignoring the `---`/`+++` file headers. */
function countChanges(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

/** An untracked file has no blob to diff against, so render its contents as all-added. */
function asAllAdded(text: string): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop() // a trailing newline is not a line
  return lines.map(line => `+${line}`).join('\n')
}

/**
 * The diff for one changed file in the checkout at `cwd`.
 *
 * Tracked files diff against `HEAD`, not the index, so a change the agent staged still shows;
 * that also matches `git status --porcelain`, which is what dotted the file in the first place.
 * An untracked file is rendered as all-added from its contents, since `git diff --no-index`
 * exits non-zero on a difference and would read as a failure here.
 *
 * Returns null when the path is unsafe, unreadable, or has no diff to show.
 */
export async function readFileDiff(
  cwd: string,
  path: string,
  status: FileGitStatus,
  git: GitRunner = nodeGitRunner(),
): Promise<FileDiff | null> {
  if (!safeRepoPath(path)) return null

  if (status === 'untracked') {
    const raw = await readConfinedFile(cwd, path)
    if (!raw) return null
    if (raw.includes(0)) return { path, status, patch: '', added: 0, removed: 0, truncated: false, binary: true }
    const { body: patch, truncated } = cutToPreview(asAllAdded(raw.toString('utf8')))
    return { path, status, patch, ...countChanges(patch), truncated, binary: false }
  }

  // `HEAD` is missing in a repo with no commits yet; the working-tree diff is the honest answer
  // there rather than an error.
  const raw = await git(['diff', '--unified=3', 'HEAD', '--', path], cwd)
    .catch(() => git(['diff', '--unified=3', '--', path], cwd))
    .catch(() => '')
  if (!raw.trim()) return null
  if (/^Binary files /m.test(raw)) return { path, status, patch: '', added: 0, removed: 0, truncated: false, binary: true }

  const { body: patch, truncated } = cutToPreview(hunksOnly(raw))
  if (!patch) return null
  return { path, status, patch, ...countChanges(patch), truncated, binary: false }
}

/**
 * Every changed file in the checkout at `cwd`, with its line counts: the session's Changes list
 * (#817). One `git status` plus one `git diff --numstat`, not a diff per file, so a session that
 * touched forty files still costs two git calls.
 *
 * Untracked files have no numstat entry (they are not in the diff at all), so their added count
 * is their line count, read from disk. Sorted by path, so the list does not reshuffle as a live
 * session edits.
 */
export async function readFileChanges(
  cwd: string,
  statuses: Record<string, FileGitStatus>,
  git: GitRunner = nodeGitRunner(),
): Promise<FileChange[]> {
  const paths = Object.keys(statuses).filter(safeRepoPath)
  if (paths.length === 0) return []

  const numstat = await git(['diff', '--numstat', 'HEAD'], cwd)
    .catch(() => git(['diff', '--numstat'], cwd))
    .catch(() => '')
  const counted = new Map<string, { added: number; removed: number; binary: boolean }>()
  for (const line of numstat.split('\n')) {
    // `added<TAB>removed<TAB>path`, with `-` for both counts on a binary file.
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path || added === undefined || removed === undefined) continue
    const binary = added === '-' || removed === '-'
    counted.set(path, { added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary })
  }

  const changes = await Promise.all(
    paths.map(async (path): Promise<FileChange> => {
      const status = statuses[path]!
      const known = counted.get(path)
      if (known) return { path, status, ...known }
      if (status !== 'untracked') return { path, status, added: 0, removed: 0, binary: false }
      // An untracked file is not in any diff, so its whole content is the addition.
      const diff = await readFileDiff(cwd, path, status, git).catch(() => null)
      return { path, status, added: diff?.added ?? 0, removed: 0, binary: diff?.binary ?? false }
    }),
  )
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
