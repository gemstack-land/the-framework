import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from './project.js'
import { logsPath, LOGS_HEADER, THE_FRAMEWORK_DIR, gitignorePath, LOGS_GITIGNORE } from './logs.js'
import { CONVERSATIONS_GITIGNORE } from './conversations.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'
import { materializePresets } from './presets.js'
import { errorMessage } from './error-message.js'

/**
 * Install/activate a repo for The Framework (#391): create the
 * `.the-framework/` marker + seeded `LOGS.md`, committing pre-existing dirty
 * changes first so the install commit is clean. Pure core over the same
 * {@link GitRunner} + {@link StoreFs} seams as project.ts/logs.ts; the
 * endpoint/UI wiring lands in later #314 slices.
 */

/** The outcome of {@link installProject}. Failures are values, never throws. */
export type InstallResult =
  | { ok: true; alreadyActivated?: boolean; initialized?: boolean }
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
    // Auto-initialize a repo when the folder isn't one yet: The Framework treats
    // git as the source of truth, so `git init` it for the user rather than erroring.
    const insideRepo = await git(['rev-parse', '--is-inside-work-tree'], cwd)
      .then(out => out.trim() === 'true')
      .catch(() => false)
    if (!insideRepo) await git(['init'], cwd)

    // Commit pre-existing changes first so the install commit is clean.
    const status = await git(['status', '--porcelain'], cwd)
    if (status.trim()) {
      await git(['add', '-A'], cwd)
      await git(['commit', '-m', '[The Framework] uncommitted changes'], cwd)
    }

    await fs.mkdir(join(cwd, THE_FRAMEWORK_DIR))
    // The early return above already established LOGS.md is absent, so write it unconditionally.
    await fs.write(logsPath(cwd), LOGS_HEADER)
    // Keep the transient run state (events.jsonl / run.json / runs/) out of git; the committed
    // DB is LOGS.md (#313) plus the conversations (#908), each needing its own negation.
    const ignore = gitignorePath(cwd)
    if (!(await fs.exists(ignore))) await fs.write(ignore, LOGS_GITIGNORE + CONVERSATIONS_GITIGNORE)

    // Materialize the quality presets so an on-before-mergeable TODO entry's filePath resolves to a
    // real file the agent can open (#326). The .the-framework/.gitignore above keeps them out
    // of git (only LOGS.md is committed), so they are regenerated on install and track the
    // installed framework version rather than going stale in the repo's history.
    await materializePresets(cwd, fs)
    // The ticket-format spec is NOT materialized (#674): it ships inside the package and the
    // #683 context fragment points at its node_modules path, so it versions with the package.

    await git(['add', '-A'], cwd)
    await git(['commit', '-m', '[The Framework] install The Framework'], cwd)
    return insideRepo ? { ok: true } : { ok: true, initialized: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
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
 * The immediate child directories of `dir` that are their own git repo roots. A
 * child is a root when `git rev-parse --show-prefix` (the path from the repo root
 * down to the cwd) is empty; a subdir of an outer repo yields a non-empty prefix,
 * and a non-repo makes git error. This beats comparing `--show-toplevel` to the
 * child path, which breaks where the path crosses a symlink (e.g. macOS `/var` ->
 * `/private/var`). Returns the surviving paths, deduped and sorted; never throws.
 */
export async function enumerateGitRepos(dir: string, deps: EnumerateDeps = {}): Promise<string[]> {
  const git = deps.git ?? nodeGitRunner()
  const dirs = deps.dirs ?? nodeDirLister()

  const repos = new Set<string>()
  for (const child of await dirs.childDirs(dir)) {
    try {
      const prefix = await git(['rev-parse', '--show-prefix'], child)
      if (prefix.trim() === '') repos.add(child)
    } catch {
      // Not a repo (or git failed): skip.
    }
  }
  return [...repos].sort()
}
