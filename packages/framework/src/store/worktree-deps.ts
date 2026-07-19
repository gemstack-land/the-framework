import { join, relative } from 'node:path'
import { FRAMEWORK_DIR } from './run-store.js'

/**
 * Give a fresh worktree a dependency tree (#736). `node_modules` is gitignored, so
 * `git worktree add` hands the run an empty one and every command in it fails.
 *
 * Three ways to fix that: copy the tree (correct, but gigabytes per run), install
 * into each worktree (correct, but real latency on every start), or symlink the
 * parent checkout's trees in (instant, no extra disk, one store shared by N runs).
 * We symlink. The one case it is wrong for is a run that changes the lockfile —
 * that needs its own install regardless, and the agent runs the install itself.
 *
 * Directory symlinks are what make this work in a pnpm workspace: linking
 * `packages/foo/node_modules` as a whole means the `.pnpm` symlinks inside it
 * still resolve against their real location in the parent checkout.
 */

/** The dependency directory mirrored into a worktree. */
const NODE_MODULES = 'node_modules'

/** How deep below the repo root a `node_modules` is looked for (root = 0). Covers a
 *  pnpm/npm workspace's `packages/<pkg>/node_modules` without walking the world. */
const MAX_DEPTH = 2

/** Directory names never descended into while scanning for dependency trees. */
const SKIP = new Set([NODE_MODULES, '.git', FRAMEWORK_DIR, 'dist', 'build', 'coverage'])

/** The filesystem this module needs. Injectable so the scan is testable. */
export interface LinkFs {
  /** Entry names in a directory. A missing/unreadable dir yields `[]`. */
  readdir(path: string): Promise<string[]>
  /** True when `path` is a directory (following symlinks). Any error reads as `false`. */
  isDirectory(path: string): Promise<boolean>
  /** True when anything exists at `path`, symlinks included (no link following). */
  entryExists(path: string): Promise<boolean>
  /** Recursive. */
  mkdir(path: string): Promise<void>
  /** Create a directory symlink at `path` pointing to `target`. */
  symlinkDir(target: string, path: string): Promise<void>
}

/** The `node:fs/promises` implementation of {@link LinkFs}. */
export function nodeLinkFs(): LinkFs {
  return {
    async readdir(path) {
      const { readdir } = await import('node:fs/promises')
      return readdir(path).catch(() => [])
    },
    async isDirectory(path) {
      const { stat } = await import('node:fs/promises')
      return stat(path).then(s => s.isDirectory(), () => false)
    },
    async entryExists(path) {
      const { lstat } = await import('node:fs/promises')
      return lstat(path).then(() => true, () => false)
    },
    async mkdir(path) {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(path, { recursive: true })
    },
    async symlinkDir(target, path) {
      const { symlink } = await import('node:fs/promises')
      // 'junction' is the only directory-link type Windows grants without elevation;
      // it is ignored on POSIX.
      await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
    },
  }
}

/**
 * Every `node_modules` directory in `repo`, as repo-relative paths, down to
 * {@link MAX_DEPTH}. Sorted, so the linking order (and any log of it) is stable.
 */
export async function findDependencyDirs(repo: string, fs: LinkFs = nodeLinkFs()): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (await fs.isDirectory(join(dir, NODE_MODULES))) found.push(relative(repo, join(dir, NODE_MODULES)))
    if (depth >= MAX_DEPTH) return
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith('.') || SKIP.has(name)) continue
      const child = join(dir, name)
      if (await fs.isDirectory(child)) await walk(child, depth + 1)
    }
  }
  await walk(repo, 0)
  return found.sort()
}

/**
 * Symlink `repo`'s dependency trees into `worktree` at the same relative paths.
 * Returns the paths linked. Best-effort throughout: a worktree with no deps is a
 * worse run, not a failed one, so a link that cannot be made is skipped rather
 * than thrown. An existing entry is left alone (the run may have installed already).
 */
export async function linkDependencies(repo: string, worktree: string, fs: LinkFs = nodeLinkFs()): Promise<string[]> {
  const linked: string[] = []
  for (const rel of await findDependencyDirs(repo, fs)) {
    const target = join(repo, rel)
    const link = join(worktree, rel)
    try {
      if (await fs.entryExists(link)) continue
      const parent = join(link, '..')
      if (!(await fs.isDirectory(parent))) await fs.mkdir(parent)
      await fs.symlinkDir(target, link)
      linked.push(rel)
    } catch {
      // Raced, or a filesystem that refuses the link: the run still starts.
    }
  }
  return linked
}
