import { cliRunner, type CliRunner } from './cli-exec.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FrameworkSignals } from '@gemstack/ai-autopilot'
import { nodeFs } from './node-fs.js'
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

/** A {@link ProjectFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeProjectFs(): ProjectFs {
  const { isDirectory } = nodeFs()
  return { isDirectory }
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
export type GitRunner = CliRunner

/**
 * A local read: the index, a ref, or objects already on disk. Kept at the budget that used to
 * cover everything, so a hung read still fails fast instead of holding the daemon longer (#997).
 */
export const GIT_READ_TIMEOUT_MS = 10_000

/** A local mutation. Bounded by disk, but an index write on a large repo outlives a read. */
export const GIT_WRITE_TIMEOUT_MS = 30_000

/**
 * The network, or a whole checkout. `git worktree add` writes every tracked file and `git push`
 * uploads a packfile; on a large repo both routinely pass 10s, which is what #997 is about. Well
 * past the 60s `gh` allows its write actions (dashboard/gh.ts), because those are API calls.
 */
export const GIT_SLOW_TIMEOUT_MS = 120_000

/** Subcommands that only read. Everything unlisted is treated as a mutation. */
const GIT_READ_OPS = new Set([
  'branch',
  'cat-file',
  'diff',
  'log',
  'ls-files',
  'remote',
  'rev-list',
  'rev-parse',
  'show',
  'status',
  'symbolic-ref',
])

/** Subcommands bounded by the network rather than by this machine. */
const GIT_SLOW_OPS = new Set(['clone', 'fetch', 'pull', 'push'])

/** Global options whose value is the next word, so that word is not the subcommand. */
const GIT_GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/**
 * The subcommand and its own words, with the leading global options dropped. A bare flag filter
 * would read `git -C /repo push` as the subcommand `/repo`, costing `push` its slow budget.
 */
function gitWords(args: string[]): string[] {
  let i = 0
  while (i < args.length) {
    const arg = args[i] ?? ''
    if (!arg.startsWith('-')) break
    // The `--opt=value` form carries its value inline; the separate form eats the next word.
    i += GIT_GLOBAL_VALUE_OPTIONS.has(arg) ? 2 : 1
  }
  return args.slice(i).filter(arg => !arg.startsWith('-'))
}

/**
 * The timeout for one git invocation, chosen by subcommand (#997). One flat 10s budget covered
 * the repo's ~20 call sites, so the slowest two ran under what is really a read's budget: a
 * SIGTERM'd `worktree add` drops a run into the user's main checkout, a SIGTERM'd `push` may
 * have half-landed. Mirrors the read/write split `gh` already has (dashboard/gh.ts).
 */
export function gitTimeoutMs(args: string[]): number {
  const words = gitWords(args)
  const op = words[0] ?? ''
  if (GIT_SLOW_OPS.has(op)) return GIT_SLOW_TIMEOUT_MS
  if (op === 'worktree') {
    // Only `add` writes a checkout; `list` is a read, and remove/prune are ordinary mutations.
    if (words[1] === 'add') return GIT_SLOW_TIMEOUT_MS
    return words[1] === 'list' ? GIT_READ_TIMEOUT_MS : GIT_WRITE_TIMEOUT_MS
  }
  return GIT_READ_OPS.has(op) ? GIT_READ_TIMEOUT_MS : GIT_WRITE_TIMEOUT_MS
}

/**
 * A {@link GitRunner} backed by `execFile('git', ...)`. Rejects on any git error, and with a
 * `CliTimeoutError` when the operation outran its {@link gitTimeoutMs} budget.
 *
 * The buffer is raised well past the default because a repo crawl (`git ls-files`) prints a
 * line per file, and a large checkout overruns it.
 */
export function nodeGitRunner(): GitRunner {
  return cliRunner({ bin: 'git', timeoutMs: gitTimeoutMs, maxBuffer: 16 * 1024 * 1024 })
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
