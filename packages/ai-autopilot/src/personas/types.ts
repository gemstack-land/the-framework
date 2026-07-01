import type { AnyTool } from '@gemstack/ai-sdk'
import type { LoadedSkill } from '@gemstack/ai-skills'

/**
 * A reusable, stack-aware role an agent can take on. A persona is *data*: a
 * name, a one-line role, a system-prompt fragment, and the skills/tools it
 * brings. It carries opinionated knowledge of the GemStack stack (Vike +
 * universal-orm) so an autopilot run is not generic — it knows where pages
 * live, how the schema drives migrations, and to express UI as intent.
 *
 * A persona is materialized into an `Agent` on demand (see `personaAgent`),
 * composing its `systemPrompt` with the instructions/tools of its `skills` via
 * `@gemstack/ai-skills`. Keeping it as data means it can be inspected, listed
 * in a planner roster, and routed to as a Supervisor worker — without building
 * an agent first.
 */
export interface Persona {
  /** Unique id, kebab-case by convention (e.g. `vike-page-builder`). */
  readonly name: string
  /** One-line human description — what this persona is for. */
  readonly role: string
  /** The persona's identity/instructions fragment. Skill bodies append after it. */
  readonly systemPrompt: string
  /** Skills the persona brings, composed over `@gemstack/ai-skills`. */
  readonly skills: readonly LoadedSkill[]
  /** Extra tools beyond those its skills contribute; authoritative on name collision. */
  readonly tools: readonly AnyTool[]
  /** Stack hints (package names / globs) the persona applies to; documents intent. */
  readonly appliesTo: readonly string[]
}

/** The author-facing shape passed to `definePersona`; optional fields default to empty. */
export interface PersonaSpec {
  name: string
  role: string
  systemPrompt: string
  skills?: LoadedSkill[]
  tools?: AnyTool[]
  appliesTo?: string[]
}
