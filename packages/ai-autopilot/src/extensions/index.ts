/**
 * The framework extension SPI (#190) — The Framework made modular. Installed
 * capability packages self-register instead of the CLI hardcoding the list. Two
 * agnostic units:
 *
 * - {@link FrameworkExtension} — a capability (auth, data, ...) matched by
 *   signals or opt-in, defined with {@link defineFrameworkExtension}.
 * - {@link Skill} — a doc pointer (an `llms.txt`), defined with {@link defineSkill};
 *   a framework (Vike) is a skill, not an adapter. Shared unit with Open Loop (#204).
 *
 * Match with {@link ExtensionRegistry} / {@link SkillRegistry}, compose personas
 * with {@link composePersonas}, frame a skill with {@link skillInstructions}, and
 * discover third-party `framework-*` packages with {@link loadExtensionsFromModules}.
 */
export { defineFrameworkExtension, defineSkill, ExtensionError } from './define.js'
export { matchSignals, selectActive } from './match.js'
export {
  ExtensionRegistry,
  SkillRegistry,
  builtinExtensionRegistry,
  builtinSkillRegistry,
  type MatchOptions,
} from './registry.js'
export {
  composePersonas,
  composeSkills,
  skillPersonas,
  skillInstructions,
  type ComposePersonasInput,
  type NeutralPersona,
} from './compose.js'
export {
  frameworkAuth,
  frameworkData,
  frameworkRbac,
  frameworkCrud,
  frameworkShell,
  builtinExtensions,
  builtinExtensionNames,
  vikeSkill,
  nextSkill,
  builtinSkills,
  neutralPersonas,
} from './library.js'
export {
  EXTENSION_NAME_RE,
  extensionPackageNames,
  isFrameworkExtension,
  loadExtensionsFromModules,
  type LoadedExtension,
  type FailedExtension,
  type DiscoverResult,
} from './load.js'
export type {
  FrameworkExtension,
  FrameworkExtensionSpec,
  Skill,
  SkillSpec,
  ExtensionSignals,
  FrameworkSignals,
  SignalMatch,
} from './types.js'
