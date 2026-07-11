import { join, resolve } from 'node:path'
import { nodeGitRunner, type GitRunner } from './project.js'
import { logsPath, LOGS_HEADER, THE_FRAMEWORK_DIR } from './logs.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * Install/activate a repo for The Framework (#391): create the
 * `.the-framework/` marker + seeded `LOGS.md`, committing pre-existing dirty
 * changes first so the install commit is clean. Pure core over the same
 * {@link GitRunner} + {@link StoreFs} seams as project.ts/logs.ts; the
 * endpoint/UI wiring lands in later #314 slices.
 */

/** The outcome of {@link installProject}. Failures are values, never throws. */
export type InstallResult =
  | { ok: true; alreadyActivated?: boolean }
  | { ok: false; error: string }

/** Injectable seams for {@link installProject}. */
export interface InstallDeps {
  git?: GitRunner
  fs?: StoreFs
}

/**
 * Activate the repo at `cwd`: commit any pre-existing dirty changes, create
 * `.the-framework/` with a seeded `LOGS.md`, and commit the install. A repo
 * with the log file already present is a no-op (`alreadyActivated`).
 * Forgiving: any git/fs failure surfaces as `{ ok: false, error }`.
 */
export async function installProject(cwd: string, deps: InstallDeps = {}): Promise<InstallResult> {
  const git = deps.git ?? nodeGitRunner()
  const fs = deps.fs ?? nodeStoreFs()

  if (await fs.exists(logsPath(cwd))) return { ok: true, alreadyActivated: true }

  try {
    // Commit pre-existing changes first so the install commit is clean.
    const status = await git(['status', '--porcelain'], cwd)
    if (status.trim()) {
      await git(['add', '-A'], cwd)
      await git(['commit', '-m', '[The Framework] uncommitted changes'], cwd)
    }

    await fs.mkdir(join(cwd, THE_FRAMEWORK_DIR))
    const path = logsPath(cwd)
    if (!(await fs.exists(path))) await fs.write(path, LOGS_HEADER)

    await git(['add', '-A'], cwd)
    await git(['commit', '-m', '[The Framework] install The Framework'], cwd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Minimal directory-listing seam so {@link enumerateGitRepos} is unit-testable. */
export interface DirLister {
  /** Absolute paths of the immediate subdirectories of `dir`. Missing/non-dir/error yields `[]`. */
  childDirs(dir: string): Promise<string[]>
}

/**
 * A {@link DirLister} backed by `node:fs/promises`. The import is dynamic so
 * the module core stays free of a hard `node:fs` dependency, same convention
 * as {@link nodeStoreFs}; any error reads as `[]`.
 */
export function nodeDirLister(): DirLister {
  return {
    async childDirs(dir) {
      try {
        const { readdir } = await import('node:fs/promises')
        const entries = await readdir(dir, { withFileTypes: true })
        return entries.filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name))
      } catch {
        return []
      }
    },
  }
}

/** Injectable seams for {@link enumerateGitRepos}. */
export interface EnumerateDeps {
  git?: GitRunner
  dirs?: DirLister
}

/**
 * The immediate child directories of `dir` that are their own git repo roots
 * (`git rev-parse --show-toplevel` resolves to the child itself). A child that
 * is not a repo, or merely a subdir of an outer repo, is skipped. Returns the
 * surviving paths, deduped and sorted. Forgiving: never throws.
 */
export async function enumerateGitRepos(dir: string, deps: EnumerateDeps = {}): Promise<string[]> {
  const git = deps.git ?? nodeGitRunner()
  const dirs = deps.dirs ?? nodeDirLister()

  const repos = new Set<string>()
  for (const child of await dirs.childDirs(dir)) {
    try {
      const toplevel = await git(['rev-parse', '--show-toplevel'], child)
      if (resolve(toplevel.trim()) === resolve(child)) repos.add(child)
    } catch {
      // Not a repo (or git failed): skip.
    }
  }
  return [...repos].sort()
}
