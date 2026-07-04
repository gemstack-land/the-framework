import type { ExtensionSignals, FrameworkSignals, SignalMatch } from './types.js'

/** Weight of a matched dependency vs a matched file — deps are the stronger signal. */
const DEP_WEIGHT = 2
const FILE_WEIGHT = 1

function depNames(deps: FrameworkSignals['dependencies']): Set<string> {
  if (!deps) return new Set()
  return new Set(Array.isArray(deps) ? deps : Object.keys(deps))
}

/**
 * Score a unit's {@link ExtensionSignals} against a project's
 * {@link FrameworkSignals}. Deterministic and mirrors preset detection: deps
 * weigh more than files. A `score > 0` means the unit is present in the project
 * and should auto-activate. Unlike preset selection (exactly one wins), many
 * extensions can match at once.
 */
export function matchSignals(signals: ExtensionSignals, project: FrameworkSignals): SignalMatch {
  const deps = depNames(project.dependencies)
  const files = project.files ?? []
  const reasons: string[] = []
  let score = 0

  for (const dep of signals.dependencies ?? []) {
    if (deps.has(dep)) {
      score += DEP_WEIGHT
      reasons.push(`dependency "${dep}"`)
    }
  }
  for (const pattern of signals.files ?? []) {
    if (files.some(f => pattern.test(f))) {
      score += FILE_WEIGHT
      reasons.push(`file matching ${pattern}`)
    }
  }
  return { score, reasons }
}

/**
 * Select the units active for a project: those whose signals matched, unioned
 * with any explicitly included by name (opt-in, regardless of signals — how a
 * from-scratch build activates a capability whose package is not installed yet).
 * Registration order is preserved.
 */
export function selectActive<T extends { name: string; signals: ExtensionSignals }>(
  units: readonly T[],
  project: FrameworkSignals,
  include: Iterable<string> = [],
): T[] {
  const forced = new Set(include)
  return units.filter(u => forced.has(u.name) || matchSignals(u.signals, project).score > 0)
}
