import type { FrameworkDetection, FrameworkSignals, FrameworkPreset, FrameworkPresetScore } from './types.js'

/** Weight of a matched dependency vs a matched file — deps are the stronger signal. */
const DEP_WEIGHT = 2
const FILE_WEIGHT = 1

function depNames(deps: FrameworkSignals['dependencies']): Set<string> {
  if (!deps) return new Set()
  return new Set(Array.isArray(deps) ? deps : Object.keys(deps))
}

/**
 * Score each preset against a project's {@link FrameworkSignals} and return the
 * best match. Deterministic: dependencies weigh more than files, and every
 * preset's score is returned (highest first) so ties are inspectable. When no
 * preset matches, `preset`/`framework` are undefined and `confidence` is 0 — the
 * caller decides the fallback (usually the flagship preset).
 */
export function detectFramework(
  presets: readonly FrameworkPreset[],
  signals: FrameworkSignals,
): FrameworkDetection {
  const deps = depNames(signals.dependencies)
  const files = signals.files ?? []

  const scores: FrameworkPresetScore[] = presets.map(preset => {
    const reasons: string[] = []
    let score = 0

    for (const dep of preset.signals.dependencies ?? []) {
      if (deps.has(dep)) {
        score += DEP_WEIGHT
        reasons.push(`dependency "${dep}"`)
      }
    }
    for (const pattern of preset.signals.files ?? []) {
      if (files.some(f => pattern.test(f))) {
        score += FILE_WEIGHT
        reasons.push(`file matching ${pattern}`)
      }
    }
    return { preset: preset.name, score, reasons }
  })

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const winner = top && top.score > 0 ? presets.find(p => p.name === top.preset) : undefined

  return {
    ...(winner ? { preset: winner, framework: winner.framework } : {}),
    confidence: top?.score ?? 0,
    scores,
  }
}
