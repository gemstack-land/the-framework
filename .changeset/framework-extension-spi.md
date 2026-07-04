---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': minor
---

Make The Framework modular: a capability-extension + skill SPI, discovered instead of hardcoded

The composition was pinned in `run.ts` (a fixed `vikeExtensionPersonas` list swapped in behind `--compose-extensions`), so no third party could publish a `framework-*` package and have it compose. This adds the extension SPI (#190), all agnostic (nothing is framework-gated):

- `defineFrameworkExtension` — a capability (auth, data, rbac, crud, shell, ...) that self-registers, matched by signal (a dependency is present) or opt-in, and frames the agent with its personas. An extension supersedes the neutral default persona of the same `capability` (e.g. `framework-data` replaces the default ORM modeler), so the agent never gets two conflicting personas for one concern.
- `defineSkill` — a doc pointer (an `llms.txt`), the shared unit with Open Loop (#204). A framework is a skill, not an adapter package: Vike now rides the same seam as `https://vike.dev/llms.txt`.
- `ExtensionRegistry` / `SkillRegistry`, `composePersonas`, `skillInstructions`, and `loadExtensionsFromModules` for discovering installed `framework-*` packages.

`run.ts` now composes matched extensions + skills through the registry instead of the hardcoded list, and the CLI reads the project's real signals and discovers installed `framework-*` capability packages (resolved from the user's workspace, failures reported not thrown). The built-in vike-* composers ship as extensions (`framework-auth`, `framework-data`, `framework-rbac`, `framework-crud`, `framework-shell`) and Vike ships as a skill, proving the seam. `--compose-extensions` still opts every built-in in; the publish-safe default (hand-rolled + Prisma) is unchanged. Closes #190.
