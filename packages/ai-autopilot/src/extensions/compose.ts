import type { Persona } from '../personas/types.js'
import type { FrameworkExtension, Skill } from './types.js'

/** A neutral default persona keyed by the capability an extension would supersede. */
export interface NeutralPersona {
  capability: string
  persona: Persona
}

/** Inputs to {@link composePersonas}. */
export interface ComposePersonasInput {
  /** Always-on base personas (e.g. a preset's page builder). */
  base?: readonly Persona[]
  /** The active capability extensions. */
  extensions: readonly FrameworkExtension[]
  /** Neutral defaults; one is dropped when an active extension owns its capability. */
  neutral?: readonly NeutralPersona[]
}

/**
 * Compose the persona set for a run: the base personas, the active extensions'
 * personas, then the neutral defaults for any capability no active extension
 * covers. An extension supersedes a neutral default of the same capability (e.g.
 * a `data` extension replaces the default ORM modeler), so the agent is never
 * framed with two conflicting personas for one concern. Order is stable:
 * base → extensions (registration order) → surviving neutral defaults.
 */
export function composePersonas(input: ComposePersonasInput): Persona[] {
  const covered = new Set(input.extensions.map(e => e.capability))
  const neutral = (input.neutral ?? []).filter(n => !covered.has(n.capability)).map(n => n.persona)
  return [...(input.base ?? []), ...input.extensions.flatMap(e => e.personas), ...neutral]
}

/**
 * Render a doc-pointer {@link Skill} as a system-prompt fragment: what the
 * knowledge is and where its `llms.txt` lives, so the agent consults the source
 * of truth for that framework/domain instead of guessing.
 */
export function skillInstructions(skill: Skill): string {
  return [
    `# Skill: ${skill.title}`,
    '',
    skill.description,
    '',
    `Authoritative, LLM-optimized docs: ${skill.url}`,
    `When you need ${skill.title} specifics, consult that document rather than relying on memory.`,
  ].join('\n')
}
