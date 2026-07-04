import type { ExtensionSignals, FrameworkExtension, FrameworkExtensionSpec, Skill, SkillSpec } from './types.js'

/** Thrown when an extension or skill spec is malformed. Fails fast at definition time. */
export class ExtensionError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'ExtensionError'
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function frozenSignals(signals: ExtensionSignals | undefined): ExtensionSignals {
  return Object.freeze({
    dependencies: Object.freeze([...(signals?.dependencies ?? [])]),
    files: Object.freeze([...(signals?.files ?? [])]),
  })
}

/**
 * Validate a {@link FrameworkExtensionSpec} and return a frozen
 * {@link FrameworkExtension}. Optional fields default to empty so callers never
 * null-check them. A third-party `framework-*` package's default export is the
 * result of this call.
 */
export function defineFrameworkExtension(spec: FrameworkExtensionSpec): FrameworkExtension {
  const name = spec.name?.trim()
  if (!name) throw new ExtensionError('extension name is required')
  if (!KEBAB.test(name)) throw new ExtensionError(`extension name must be kebab-case: ${JSON.stringify(spec.name)}`)
  const capability = spec.capability?.trim()
  if (!capability) throw new ExtensionError(`extension "${name}" needs a capability`)
  if (!KEBAB.test(capability)) {
    throw new ExtensionError(`extension "${name}" capability must be kebab-case: ${JSON.stringify(spec.capability)}`)
  }

  return Object.freeze({
    name,
    capability,
    personas: Object.freeze([...(spec.personas ?? [])]),
    skills: Object.freeze([...(spec.skills ?? [])]),
    signals: frozenSignals(spec.signals),
  })
}

/**
 * Validate a {@link SkillSpec} and return a frozen {@link Skill} — a doc pointer
 * (an `llms.txt` URL) an agent consults for framework/domain knowledge.
 */
export function defineSkill(spec: SkillSpec): Skill {
  const name = spec.name?.trim()
  if (!name) throw new ExtensionError('skill name is required')
  if (!KEBAB.test(name)) throw new ExtensionError(`skill name must be kebab-case: ${JSON.stringify(spec.name)}`)
  if (!spec.title?.trim()) throw new ExtensionError(`skill "${name}" needs a title`)
  if (!spec.description?.trim()) throw new ExtensionError(`skill "${name}" needs a description`)
  const url = spec.url?.trim()
  if (!url) throw new ExtensionError(`skill "${name}" needs a url (its llms.txt pointer)`)

  return Object.freeze({
    name,
    title: spec.title.trim(),
    description: spec.description.trim(),
    url,
    personas: Object.freeze([...(spec.personas ?? [])]),
    signals: frozenSignals(spec.signals),
  })
}
