import type { FrameworkPreset, FrameworkPresetSpec } from './types.js'

/** Thrown when a `FrameworkPresetSpec` is malformed. Fails fast at definition time. */
export class FrameworkPresetError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'FrameworkPresetError'
  }
}

/**
 * Validate a {@link FrameworkPresetSpec} and return a frozen
 * {@link FrameworkPreset}. Optional fields default to empty so callers never
 * null-check them.
 */
export function defineFrameworkPreset(spec: FrameworkPresetSpec): FrameworkPreset {
  const name = spec.name?.trim()
  if (!name) throw new FrameworkPresetError('preset name is required')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new FrameworkPresetError(`preset name must be kebab-case: ${JSON.stringify(spec.name)}`)
  }
  if (!spec.framework?.trim()) throw new FrameworkPresetError(`preset "${name}" needs a framework name`)

  return Object.freeze({
    name,
    framework: spec.framework.trim(),
    signals: Object.freeze({
      dependencies: Object.freeze([...(spec.signals?.dependencies ?? [])]),
      files: Object.freeze([...(spec.signals?.files ?? [])]),
    }),
  })
}
