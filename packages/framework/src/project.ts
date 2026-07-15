import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FrameworkSignals } from '@gemstack/ai-autopilot'
import { THE_FRAMEWORK_DIR } from './logs.js'

/**
 * Project-level repo helpers (#380): the `.the-framework/` activation marker
 * check, a `git ls-files` crawl, and the project's detection signals. Read-only
 * building blocks for the #314 sidebars; activation/install (creating the dir,
 * the install commit) is a separate, deferred concern.
 */

/**
 * Read a project's detection signals from its `package.json`: the union of
 * `dependencies` + `devDependencies` names. Returns empty signals when there is
 * no `package.json` (a from-scratch build in an empty workspace) so preset
 * detection simply finds nothing rather than throwing.
 */
export function readProjectSignals(cwd: string): FrameworkSignals {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return { dependencies }
}

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
