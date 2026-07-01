import type { Persona, PersonaSpec } from './types.js'

/** Thrown when a `PersonaSpec` is malformed. Fails fast at definition time. */
export class PersonaError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'PersonaError'
  }
}

/**
 * Validate a {@link PersonaSpec} and return a frozen {@link Persona}.
 *
 * Optional fields default to empty arrays so the rest of the library never has
 * to null-check them. The result is deep-frozen at the top level: a persona is
 * a shared, reusable identity, so mutating one after definition is a bug.
 */
export function definePersona(spec: PersonaSpec): Persona {
  const name = spec.name?.trim()
  if (!name) throw new PersonaError('persona name is required')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new PersonaError(`persona name must be kebab-case: ${JSON.stringify(spec.name)}`)
  }
  if (!spec.role?.trim()) throw new PersonaError(`persona "${name}" needs a role`)
  if (!spec.systemPrompt?.trim()) throw new PersonaError(`persona "${name}" needs a systemPrompt`)

  const persona: Persona = {
    name,
    role: spec.role.trim(),
    systemPrompt: spec.systemPrompt.trim(),
    skills: Object.freeze([...(spec.skills ?? [])]),
    tools: Object.freeze([...(spec.tools ?? [])]),
    appliesTo: Object.freeze([...(spec.appliesTo ?? [])]),
  }
  return Object.freeze(persona)
}
