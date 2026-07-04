import type { Persona } from '../personas/types.js'
import type { FrameworkExtension, Skill } from './types.js'

/** A neutral default persona keyed by the capability an extension would supersede. */
export interface NeutralPersona {
  capability: string
  persona: Persona
}

/** Inputs to {@link composePersonas}. */
export interface ComposePersonasInput {
  /** Always-on base personas (e.g. the framework skill's page builder). */
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
 * Compose the skill set for a run: the registry-matched skills (activated by the
 * project's own signals) plus every skill an active extension pulls in, deduped
 * by name so a registry skill is not shadowed when an extension re-declares it
 * (first occurrence wins). Keeps the two skill sources in one place, symmetric
 * with {@link composePersonas}.
 */
export function composeSkills(input: { matched?: readonly Skill[]; extensions: readonly FrameworkExtension[] }): Skill[] {
  const out: Skill[] = []
  const seen = new Set<string>()
  for (const skill of [...(input.matched ?? []), ...input.extensions.flatMap(e => e.skills)]) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    out.push(skill)
  }
  return out
}

/**
 * The framing personas an active skill set brings — every skill's curated
 * {@link Skill.personas} in order, deduped by name (first occurrence wins).
 * These are the base personas for a run (e.g. the detected framework's page
 * builder), symmetric with {@link composeSkills}: the same skill carries both
 * its doc pointer and the personas that knowledge always frames the agent with.
 */
export function skillPersonas(skills: readonly Skill[]): Persona[] {
  const out: Persona[] = []
  const seen = new Set<string>()
  for (const persona of skills.flatMap(s => s.personas)) {
    if (seen.has(persona.name)) continue
    seen.add(persona.name)
    out.push(persona)
  }
  return out
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
