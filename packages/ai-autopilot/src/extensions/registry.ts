import { selectActive } from './match.js'
import { builtinExtensions, builtinSkills } from './library.js'
import type { FrameworkExtension, FrameworkSignals, Skill } from './types.js'

/** Options for {@link ExtensionRegistry.match} / {@link SkillRegistry.match}. */
export interface MatchOptions {
  /** Force these units active by name regardless of signals (explicit opt-in). */
  include?: readonly string[]
}

/**
 * A set of {@link FrameworkExtension}s with signal + opt-in matching. Register
 * the built-ins (or discovered `framework-*` packages), then {@link match} the
 * ones active for a project. The registry only decides *which* capabilities to
 * compose; composition itself is `composePersonas`.
 */
export class ExtensionRegistry {
  private readonly byName = new Map<string, FrameworkExtension>()

  constructor(extensions: readonly FrameworkExtension[] = builtinExtensions()) {
    for (const e of extensions) this.byName.set(e.name, e)
  }

  /** The extension with this name, or `undefined`. */
  get(name: string): FrameworkExtension | undefined {
    return this.byName.get(name)
  }

  /** All extensions, in registration order. */
  all(): FrameworkExtension[] {
    return [...this.byName.values()]
  }

  /** Add or replace an extension (e.g. a discovered third-party one). Returns `this`. */
  add(extension: FrameworkExtension): this {
    this.byName.set(extension.name, extension)
    return this
  }

  /** Add many extensions. Returns `this`. */
  addAll(extensions: Iterable<FrameworkExtension>): this {
    for (const e of extensions) this.add(e)
    return this
  }

  /** The extensions active for a project: signal-matched ∪ explicitly included. */
  match(project: FrameworkSignals, opts: MatchOptions = {}): FrameworkExtension[] {
    return selectActive(this.all(), project, opts.include ?? [])
  }
}

/** A set of {@link Skill}s (doc pointers) with the same signal + opt-in matching. */
export class SkillRegistry {
  private readonly byName = new Map<string, Skill>()

  constructor(skills: readonly Skill[] = builtinSkills()) {
    for (const s of skills) this.byName.set(s.name, s)
  }

  /** The skill with this name, or `undefined`. */
  get(name: string): Skill | undefined {
    return this.byName.get(name)
  }

  /** All skills, in registration order. */
  all(): Skill[] {
    return [...this.byName.values()]
  }

  /** Add or replace a skill. Returns `this`. */
  add(skill: Skill): this {
    this.byName.set(skill.name, skill)
    return this
  }

  /** Add many skills. Returns `this`. */
  addAll(skills: Iterable<Skill>): this {
    for (const s of skills) this.add(s)
    return this
  }

  /** The skills active for a project: signal-matched ∪ explicitly included. */
  match(project: FrameworkSignals, opts: MatchOptions = {}): Skill[] {
    return selectActive(this.all(), project, opts.include ?? [])
  }
}

/** The built-in extensions as a ready-to-use {@link ExtensionRegistry}. */
export function builtinExtensionRegistry(): ExtensionRegistry {
  return new ExtensionRegistry(builtinExtensions())
}

/** The built-in skills as a ready-to-use {@link SkillRegistry}. */
export function builtinSkillRegistry(): SkillRegistry {
  return new SkillRegistry(builtinSkills())
}
