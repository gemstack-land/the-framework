import type { Preset, PresetSpec } from './types.js'

/** Thrown when a `PresetSpec` is malformed. Fails fast at definition time. */
export class PresetError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'PresetError'
  }
}

/**
 * Validate a {@link PresetSpec} and return a frozen {@link Preset}. Optional
 * fields default to empty so callers never null-check them.
 */
export function definePreset(spec: PresetSpec): Preset {
  const name = spec.name?.trim()
  if (!name) throw new PresetError('preset name is required')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new PresetError(`preset name must be kebab-case: ${JSON.stringify(spec.name)}`)
  }
  if (!spec.framework?.trim()) throw new PresetError(`preset "${name}" needs a framework name`)

  return Object.freeze({
    name,
    framework: spec.framework.trim(),
    personas: Object.freeze([...(spec.personas ?? [])]),
    signals: Object.freeze({
      dependencies: Object.freeze([...(spec.signals?.dependencies ?? [])]),
      files: Object.freeze([...(spec.signals?.files ?? [])]),
    }),
  })
}
