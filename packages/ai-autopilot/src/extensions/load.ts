import type { FrameworkExtension } from './types.js'

/**
 * The `framework-*` package-name convention: a bare `framework-<name>` or a
 * scoped `@scope/framework-<name>`. Matching packages in a project's
 * dependencies are candidate {@link FrameworkExtension}s to discover.
 */
export const EXTENSION_NAME_RE = /^(?:@[a-z0-9-]+\/)?framework-[a-z0-9-]+$/

/**
 * Filter a dependency list down to `framework-*` extension package names.
 * Deduped and sorted for determinism; `exclude` drops packages that match the
 * convention but are not extensions (e.g. the framework core `@gemstack/framework`).
 */
export function extensionPackageNames(deps: Iterable<string>, opts: { exclude?: readonly string[] } = {}): string[] {
  const exclude = new Set(opts.exclude ?? [])
  return [...new Set(deps)].filter(name => EXTENSION_NAME_RE.test(name) && !exclude.has(name)).sort()
}

/** A duck-typed check that a loaded module's export is a {@link FrameworkExtension}. */
export function isFrameworkExtension(value: unknown): value is FrameworkExtension {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.capability === 'string' &&
    Array.isArray(v.personas) &&
    Array.isArray(v.skills) &&
    typeof v.signals === 'object' &&
    v.signals !== null
  )
}

/** A successfully discovered extension and the package it came from. */
export interface LoadedExtension {
  package: string
  extension: FrameworkExtension
}

/** A package that matched the convention but could not be loaded as an extension. */
export interface FailedExtension {
  package: string
  error: string
}

/** The outcome of {@link loadExtensionsFromModules}: what loaded and what didn't. */
export interface DiscoverResult {
  loaded: LoadedExtension[]
  failed: FailedExtension[]
}

/**
 * Load {@link FrameworkExtension}s from `framework-*` package names using a
 * caller-supplied `load` function (an `import`-like). Pure with respect to the
 * filesystem: the CLI passes a loader that resolves from the user's workspace,
 * tests pass a fake map — so the SPI stays testable without disk or real
 * packages. An extension export is taken from `default`, then `extension`, then
 * the module itself. A package that fails to load or exports no extension is
 * collected in `failed`, never thrown, so one bad package cannot abort a run.
 */
export async function loadExtensionsFromModules(
  packageNames: readonly string[],
  load: (name: string) => Promise<unknown>,
): Promise<DiscoverResult> {
  const loaded: LoadedExtension[] = []
  const failed: FailedExtension[] = []
  for (const name of packageNames) {
    try {
      const mod = (await load(name)) as Record<string, unknown> | undefined
      const candidate = mod?.['default'] ?? mod?.['extension'] ?? mod
      if (isFrameworkExtension(candidate)) loaded.push({ package: name, extension: candidate })
      else failed.push({ package: name, error: 'no FrameworkExtension export (default/extension)' })
    } catch (err) {
      failed.push({ package: name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { loaded, failed }
}
