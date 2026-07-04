import type { Persona } from '../personas/types.js'
import type { FrameworkSignals, PresetSignals } from '../presets/types.js'

/**
 * The framework extension SPI (#190). The Framework is modular: installed
 * capability packages self-register instead of the CLI hardcoding the list. The
 * model is two units, both agnostic (nothing is Vike-gated):
 *
 * - {@link FrameworkExtension} — a capability (auth, data, ...) that frames the
 *   agent with personas when it matches a project.
 * - {@link Skill} — a doc pointer (framework/domain knowledge = an `llms.txt`),
 *   the shared unit with Open Loop (#204).
 *
 * A framework is not a special package: it is a {@link Skill} pointing at its
 * `llms.txt`. There is no adapter axis.
 */

/** How a unit is recognized in a project — the same deps/files shape presets use. */
export type ExtensionSignals = PresetSignals

/** Re-export the project-side signal shape (a project's deps + file list) for callers. */
export type { FrameworkSignals } from '../presets/types.js'

/**
 * A doc-pointer skill: framework or domain knowledge an agent pulls in by
 * reading an `llms.txt`. Distinct from `@gemstack/ai-skills`' on-disk
 * `SKILL.md`/`LoadedSkill` (instructions + tools) — a {@link Skill} is just a
 * pointer, the lightweight unit shared with Open Loop (#204). Vike is a skill
 * (https://vike.dev/llms.txt), not an adapter package.
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
  /** When to auto-activate it; empty means opt-in only. */
  readonly signals: ExtensionSignals
}

/** The author-facing shape for {@link defineSkill}; `signals` defaults to empty. */
export interface SkillSpec {
  name: string
  title: string
  description: string
  url: string
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
