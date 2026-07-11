import { join } from 'node:path'
import { THE_FRAMEWORK_DIR } from './logs.js'

/**
 * Project-level repo helpers (#380): the `.the-framework/` activation marker
 * check and a `git ls-files` crawl. Read-only building blocks for the #314
 * sidebars; activation/install (creating the dir, the install commit) is a
 * separate, deferred concern.
 */

/** The `.the-framework/` path under a project root. */
export function theFrameworkDir(cwd: string): string {
  return join(cwd, THE_FRAMEWORK_DIR)
}

/** Minimal fs seam so activation is unit-testable without touching disk. */
export interface ProjectFs {
  /** True when `path` exists AND is a directory. */
  isDirectory(path: string): Promise<boolean>
}

/**
 * A {@link ProjectFs} backed by `node:fs/promises`. The import is dynamic so
 * the module core stays free of a hard `node:fs` dependency, same convention
 * as {@link nodeStoreFs}; any stat error reads as `false`.
 */
export function nodeProjectFs(): ProjectFs {
  return {
    async isDirectory(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
  }
}

/**
 * A repo is "activated"/installed for The Framework when it has a
 * `.the-framework/` directory (#314: the dir is the activation marker).
 * Read-only check; creating the dir + the install commit is a separate,
 * deferred concern.
 */
export async function isActivated(cwd: string, fs: ProjectFs = nodeProjectFs()): Promise<boolean> {
  return fs.isDirectory(theFrameworkDir(cwd))
}

/** Runs `git` in `cwd` and resolves stdout. Injectable so the crawl is testable. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

/** A {@link GitRunner} backed by `execFile('git', ...)`. Rejects on any git error. */
export function nodeGitRunner(): GitRunner {
  return async (args, cwd) => {
    const { execFile } = await import('node:child_process')
    return new Promise((resolvePromise, rejectPromise) => {
      execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) rejectPromise(err)
        else resolvePromise(String(stdout))
      })
    })
  }
}

/**
 * List every file git sees in the repo at `cwd`: tracked + untracked, honoring
 * .gitignore. Uses `git ls-files -z --cached --others --exclude-standard` (the
 * same approach Vike uses). Returns repo-relative paths, deduped and sorted.
 * Forgiving: a non-repo / missing git / any failure yields `[]`, never throws.
 */
export async function crawlRepoFiles(cwd: string, run: GitRunner = nodeGitRunner()): Promise<string[]> {
  try {
    const out = await run(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
    const files = new Set<string>()
    for (const entry of out.split('\0')) {
      const trimmed = entry.trim()
      if (trimmed) files.add(trimmed)
    }
    return [...files].sort()
  } catch {
    return []
  }
}
