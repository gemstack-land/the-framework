import type { LoopEvent } from '../loop/types.js'
import type { MaterialChange } from './types.js'

/**
 * The material-change detector — the whole point of scale mode. A `CODE-OVERVIEW`
 * that lags the code is worse than none, so it must refresh on the changes that
 * actually move the map (build tooling, test framework, directory layout, a new
 * area) and ignore the routine edits that don't. This is deterministic and
 * path-driven so it is cheap to run on every loop event.
 *
 * Signals (validated against Cloudflare's published reviewer, which hit the same
 * "instructions rot fast" problem): build/config change, test-tooling change,
 * directory restructure, and a large change touching many files.
 */

/** Build / config files whose change reshapes how the app is built or run. */
const BUILD_CONFIG: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)turbo\.json$/,
  /(^|\/)tsconfig(\.[\w-]+)?\.json$/,
  /(^|\/)(vite|rollup|webpack|esbuild|astro|svelte|nuxt|next)\.config\.[cm]?[jt]s$/,
  /\.config\.[cm]?[jt]s$/,
]

/** Test-tooling files whose change signals a framework migration. */
const TEST_TOOLING: RegExp[] = [
  /(^|\/)(vitest|jest|playwright|cypress|karma|ava)\.config\.[cm]?[jt]s$/,
  /(^|\/)jest\.setup\.[cm]?[jt]s$/,
]

/** Summary keywords that describe a structural change even without telltale paths. */
const RESTRUCTURE_WORDS = /\b(restructur|reorganiz|reorganis|migrat|rename|move[ds]?|scaffold|new (module|package|area|service))\b/i

/** Options for {@link detectMaterialChange}. */
export interface DetectOptions {
  /** A change touching at least this many files counts as material. Default 8. */
  manyFilesThreshold?: number
  /** Extra path patterns to treat as material (project-specific). */
  extraPatterns?: RegExp[]
}

const first = (paths: readonly string[], patterns: RegExp[]): string | undefined =>
  paths.find(p => patterns.some(re => re.test(p)))

/** The top-level directory segment of a path (or undefined for a root-level file). */
function topDir(path: string): string | undefined {
  const clean = path.replace(/^\.?\//, '')
  const slash = clean.indexOf('/')
  return slash === -1 ? undefined : clean.slice(0, slash)
}

/**
 * Decide whether a {@link LoopEvent} is material enough to refresh the overview.
 * Pure and deterministic — same event in, same verdict out.
 */
export function detectMaterialChange(event: LoopEvent, opts: DetectOptions = {}): MaterialChange {
  const threshold = opts.manyFilesThreshold ?? 8
  const paths = event.paths ?? []
  const reasons: string[] = []

  const build = first(paths, BUILD_CONFIG)
  if (build) reasons.push(`build/config change (${build})`)

  const test = first(paths, TEST_TOOLING)
  if (test) reasons.push(`test-tooling change (${test})`)

  if (opts.extraPatterns?.length) {
    const extra = first(paths, opts.extraPatterns)
    if (extra) reasons.push(`watched path changed (${extra})`)
  }

  // A change spread across many top-level areas reshapes the structure section.
  const dirs = new Set(paths.map(topDir).filter((d): d is string => d !== undefined))
  if (paths.length >= threshold && dirs.size >= 2) {
    reasons.push(`large change across ${paths.length} files in ${dirs.size} areas`)
  }

  if (event.summary && RESTRUCTURE_WORDS.test(event.summary)) {
    reasons.push('restructure described in the change summary')
  }

  return { material: reasons.length > 0, reasons }
}
