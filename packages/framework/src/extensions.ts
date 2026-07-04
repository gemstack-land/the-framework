import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  extensionPackageNames,
  loadExtensionsFromModules,
  type FailedExtension,
  type FrameworkExtension,
  type FrameworkSignals,
} from '@gemstack/ai-autopilot'

/** The framework core package — matches the `framework-*` convention loosely but is not an extension. */
const FRAMEWORK_CORE = '@gemstack/framework'

/**
 * Read a project's detection signals from its `package.json`: the union of
 * `dependencies` + `devDeps` names. Returns empty signals when there is no
 * `package.json` (a from-scratch build in an empty workspace) so detection and
 * extension activation simply find nothing rather than throwing.
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

/** The result of {@link discoverExtensions}: what resolved and what didn't. */
export interface DiscoverExtensionsResult {
  extensions: FrameworkExtension[]
  failed: FailedExtension[]
}

/**
 * Discover installed `framework-*` capability packages in `cwd` and load their
 * {@link FrameworkExtension} exports. Resolves each package from the user's
 * workspace (not the CLI's own tree), so a project that installs
 * `framework-sentry` gets it composed without the CLI knowing about it. Bad or
 * missing packages are reported in `failed`, never thrown — one broken extension
 * cannot abort a run.
 */
export async function discoverExtensions(cwd: string, signals?: FrameworkSignals): Promise<DiscoverExtensionsResult> {
  const deps = signals?.dependencies ?? readProjectSignals(cwd).dependencies ?? {}
  const depNames = Array.isArray(deps) ? deps : Object.keys(deps)
  const names = extensionPackageNames(depNames, { exclude: [FRAMEWORK_CORE] })
  if (names.length === 0) return { extensions: [], failed: [] }

  // Resolve extension packages from the user's workspace, not the CLI's tree.
  const require = createRequire(pathToFileURL(join(cwd, 'package.json')).href)
  const load = async (name: string): Promise<unknown> => import(pathToFileURL(require.resolve(name)).href)

  const { loaded, failed } = await loadExtensionsFromModules(names, load)
  return { extensions: loaded.map(l => l.extension), failed }
}
