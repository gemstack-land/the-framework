/**
 * `@gemstack/ai-skills` — portable capability bundles for `@gemstack/ai-sdk`
 * agents. Load `SKILL.md` skills (instructions + tools + resources) and compose
 * them onto an `Agent`.
 *
 * - {@link parseSkillManifest} — parse a `SKILL.md` into manifest + body
 * - {@link loadSkill} / {@link loadSkills} — load skills from disk
 * - {@link SkillRegistry} — discover skills by cheap frontmatter, load on demand
 * - {@link composeInstructions} / {@link composeTools} / {@link composeMiddleware} — merge skills into an agent
 * - {@link SkillfulAgent} — an `Agent` base that composes `skills()` declaratively
 * - {@link surface} — inspect what a skill adds before composing it
 */
export { parseSkillManifest, SkillManifestError } from './manifest.js'
export { loadSkill, loadSkills, type LoadSkillOptions } from './loader.js'
export { SkillRegistry, type SkillIndexEntry, type DiscoverOptions } from './registry.js'
export {
  composeInstructions,
  composeTools,
  composeMiddleware,
  surface,
  surfaceAll,
} from './compose.js'
export { SkillfulAgent } from './skillful-agent.js'
export type {
  SkillManifest,
  ParsedSkill,
  LoadedSkill,
  SkillResource,
  SkillSurface,
} from './types.js'
