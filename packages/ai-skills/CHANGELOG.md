# @gemstack/ai-skills

## 0.2.0

### Minor Changes

- 3eb72d4: Quality + docs pass for ai-skills:

  - `SkillRegistry.discover()` no longer aborts the whole scan when a single `SKILL.md` is unreadable or malformed; the bad bundle is skipped and the rest are still indexed. Pass `discover(root, { onError })` to observe what was skipped. This restores the documented "index hundreds of skills safely" contract.
  - Skill `name` is now validated at parse time against `[a-zA-Z0-9_-]` instead of being silently mangled later at compose time, so invalid names fail fast with a clear message.
  - `load()` on an undiscovered name now lists the available skill names (or hints to call `discover()` first).
  - `loadSkill()` distinguishes a missing `SKILL.md` from an unreadable one.
  - Deduplicated the internal `fileExists`/`isDirectory` helpers into a shared module.
  - README: clarified that the tools module is loaded compiled (`tools.js`/`.mjs`/`.cjs`, not `tools.ts`), and added a direct `loadSkill()` usage example.

### Patch Changes

- Updated dependencies [e784b5d]
- Updated dependencies [97ed299]
- Updated dependencies [4fa5820]
- Updated dependencies [cf28664]
- Updated dependencies [035050e]
- Updated dependencies [3cb13db]
  - @gemstack/ai-sdk@0.4.0

## 0.1.0

### Minor Changes

- c9758d0: Initial release. Portable capability bundles for `@gemstack/ai-sdk` agents — load `SKILL.md` skills (instructions + tools + resources) and compose them onto an `Agent`:

  - `parseSkillManifest` — parse `SKILL.md` YAML frontmatter + markdown body (matches the `boost/skills` / Anthropic Agent Skills shape).
  - `loadSkill` / `loadSkills` — load a skill directory: instructions, co-located `tool()` exports, and `resources/`.
  - `SkillRegistry` — discover skills by their cheap frontmatter and load the full body + tools on demand (progressive disclosure).
  - `composeInstructions` / `composeTools` / `composeMiddleware` — merge skills into an agent; the agent's own declarations stay authoritative (own tools win name collisions, skill tools are namespaced as a backstop).
  - `SkillfulAgent` — an `Agent` base that composes `skills()` declaratively alongside `baseInstructions()` / `baseTools()`.
  - `surface` — inspect a skill's instructions/tools/resources before composing it.

  Explicit trust boundary (no in-process sandbox): discovery reads only frontmatter, `loadTools: false` loads without running the tools module, and skill tools flow through the agent's existing approval/middleware path. Depends on `@gemstack/ai-sdk`.

### Patch Changes

- Updated dependencies [9da9b29]
  - @gemstack/ai-sdk@0.3.0
