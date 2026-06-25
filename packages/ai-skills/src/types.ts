import type { AnyTool, AiMiddleware } from '@gemstack/ai-sdk'

/**
 * The parsed YAML frontmatter of a `SKILL.md` bundle. Mirrors the
 * `boost/skills` convention shipped in `@gemstack/ai-sdk` and the Anthropic
 * Agent Skills shape, so a skill authored for one loads in the other.
 */
export interface SkillManifest {
  /** Unique skill name (kebab-case by convention, e.g. `pdf-forms`). */
  name: string
  /** One-line summary — used to decide relevance during discovery. */
  description: string
  /** SPDX license id, optional. */
  license?: string
  /**
   * Hints (package names / globs) the skill applies to. Free-form; the loader
   * does not enforce these — they document intent and aid discovery.
   */
  appliesTo?: string[]
  /** When to load this skill (natural-language cue, for progressive disclosure). */
  trigger?: string
  /** When NOT to load it (points at a sibling skill instead). */
  skip?: string
  /** Arbitrary author metadata; passed through untouched. */
  metadata?: Record<string, unknown>
}

/** A `SKILL.md` split into its validated manifest and its markdown body. */
export interface ParsedSkill {
  manifest: SkillManifest
  /** The markdown instructions body (everything after the frontmatter). */
  instructions: string
}

/** A non-executable resource file shipped alongside a skill. */
export interface SkillResource {
  /** File name relative to the skill's `resources/` directory. */
  name: string
  /** Absolute path on disk. */
  path: string
}

/**
 * A fully loaded, ready-to-compose skill: its manifest, its instructions body,
 * the `tool()` objects it contributes, and any resource files. Loading is
 * async (file IO + importing the co-located tools module); composition onto an
 * agent is synchronous.
 */
export interface LoadedSkill {
  manifest: SkillManifest
  instructions: string
  tools: AnyTool[]
  resources: SkillResource[]
  /** Absolute path to the skill directory, when loaded from disk. */
  dir?: string
  /** Middleware the skill contributes, if any (advanced; usually empty). */
  middleware?: AiMiddleware[]
}

/**
 * A read-only summary of what a skill would add to an agent — surfaced
 * *before* composition so a caller can inspect a skill's instructions, tool
 * names, and resources without attaching it. Part of the explicit trust
 * boundary: loading a skill runs its tools module, so callers should know what
 * they are about to compose.
 */
export interface SkillSurface {
  name: string
  description: string
  trigger?: string
  /** Character length of the instructions body. */
  instructionChars: number
  /** Names of the tools the skill contributes. */
  toolNames: string[]
  /** Names of the resource files the skill ships. */
  resourceNames: string[]
}
