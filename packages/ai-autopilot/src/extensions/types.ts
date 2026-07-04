import type { Persona } from '../personas/types.js'
import type { FrameworkSignals, PresetSignals } from '../presets/types.js'

/**
 * The framework extension SPI (#190). The Framework is modular: installed
 * capability packages self-register instead of the CLI hardcoding the list. The
 * model is two units, both agnostic (nothing is Vike-gated):
 *
 * - {@link FrameworkExtension} — a capability (auth, data, ...) that frames the
 *   agent with personas when it matches a project.
 * - {@link Skill} — framework/domain knowledge: a doc pointer (an `llms.txt`)
 *   plus the curated personas it frames the agent with, the shared unit with
 *   Open Loop (#204).
 *
 * A framework is not a special package: it is a {@link Skill} carrying its page
 * builder and pointing at its `llms.txt`. There is no adapter axis, and no
 * separate seam supplies the page builder.
 */

/** How a unit is recognized in a project — the same deps/files shape presets use. */
export type ExtensionSignals = PresetSignals

/** Re-export the project-side signal shape (a project's deps + file list) for callers. */
export type { FrameworkSignals } from '../presets/types.js'

/**
 * A skill: framework or domain knowledge an agent pulls in. It carries two
 * things — a doc pointer (an `llms.txt` the agent consults) and, optionally, the
 * curated framing {@link Persona}s that knowledge always brings (e.g. Vike's page
 * builder). Distinct from `@gemstack/ai-skills`' on-disk `SKILL.md`/`LoadedSkill`
 * (instructions + tools) — a {@link Skill} is the lightweight unit shared with
 * Open Loop (#204). A framework is a skill (Vike -> https://vike.dev/llms.txt +
 * its page builder), not an adapter package; there is no adapter axis.
 */
export interface Skill {
  /** Stable kebab-case id (e.g. `vike`). */
  readonly name: string
  /** Human title (e.g. `Vike`). */
  readonly title: string
  /** One-line summary of the knowledge this skill points at. */
  readonly description: string
  /** The `llms.txt` (or other LLM-optimized doc) URL the agent should consult. */
  readonly url: string
  /** Curated personas this knowledge always frames the agent with (e.g. a page builder). Empty for a pure doc pointer. */
  readonly personas: readonly Persona[]
  /** When to auto-activate it; empty means opt-in only. */
  readonly signals: ExtensionSignals
}

/** The author-facing shape for {@link defineSkill}; `personas`/`signals` default to empty. */
export interface SkillSpec {
  name: string
  title: string
  description: string
  url: string
  personas?: readonly Persona[]
  signals?: ExtensionSignals
}

/**
 * A framework capability extension: a cross-cutting concern that self-registers
 * and composes into an autopilot run. Agnostic — a matched extension frames the
 * agent with its personas and pulls in its skills. The `capability` it owns lets
 * it supersede the neutral default persona for that concern (e.g. a `data`
 * extension replaces the default ORM modeler) so the agent never gets two
 * conflicting personas for one concern.
 */
export interface FrameworkExtension {
  /** Package/id, kebab-case, `framework-*` by convention (e.g. `framework-auth`). */
  readonly name: string
  /** The concern it owns (e.g. `auth`, `data`) — the supersession key. */
  readonly capability: string
  /** Personas it frames the agent with when active. */
  readonly personas: readonly Persona[]
  /** Doc-pointer skills it pulls in when active. */
  readonly skills: readonly Skill[]
  /** Deps/files that auto-activate it in a project. */
  readonly signals: ExtensionSignals
}

/** The author-facing shape for {@link defineFrameworkExtension}; optional fields default to empty. */
export interface FrameworkExtensionSpec {
  name: string
  capability: string
  personas?: readonly Persona[]
  skills?: readonly Skill[]
  signals?: ExtensionSignals
}

/** One unit's match against a project's {@link FrameworkSignals}. */
export interface SignalMatch {
  /** 0 when nothing matched; deps weigh more than files. */
  score: number
  /** The concrete signals that matched, for narration. */
  reasons: string[]
}
