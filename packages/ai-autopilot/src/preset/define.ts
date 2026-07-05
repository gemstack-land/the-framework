import type { DomainPreset, DomainPresetSpec } from './types.js'

/** Thrown when a domain preset spec is malformed. Fails fast at definition time. */
export class DomainPresetError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'DomainPresetError'
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Validate a {@link DomainPresetSpec} and return a frozen {@link DomainPreset}.
 * `title` defaults to `name`, `description` to empty, and the three content lists
 * to empty so callers never null-check them.
 */
export function defineDomainPreset(spec: DomainPresetSpec): DomainPreset {
  const name = spec.name?.trim()
  if (!name) throw new DomainPresetError('preset name is required')
  if (!KEBAB.test(name)) throw new DomainPresetError(`preset name must be kebab-case: ${JSON.stringify(spec.name)}`)

  return Object.freeze({
    name,
    title: spec.title?.trim() || name,
    description: spec.description?.trim() ?? '',
    loops: Object.freeze([...(spec.loops ?? [])]),
    prompts: Object.freeze([...(spec.prompts ?? [])]),
    skills: Object.freeze([...(spec.skills ?? [])]),
  })
}
