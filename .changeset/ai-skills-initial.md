---
"@gemstack/ai-skills": minor
---

Initial release. Portable capability bundles for `@gemstack/ai-sdk` agents — load `SKILL.md` skills (instructions + tools + resources) and compose them onto an `Agent`:

- `parseSkillManifest` — parse `SKILL.md` YAML frontmatter + markdown body (matches the `boost/skills` / Anthropic Agent Skills shape).
- `loadSkill` / `loadSkills` — load a skill directory: instructions, co-located `tool()` exports, and `resources/`.
- `SkillRegistry` — discover skills by their cheap frontmatter and load the full body + tools on demand (progressive disclosure).
- `composeInstructions` / `composeTools` / `composeMiddleware` — merge skills into an agent; the agent's own declarations stay authoritative (own tools win name collisions, skill tools are namespaced as a backstop).
- `SkillfulAgent` — an `Agent` base that composes `skills()` declaratively alongside `baseInstructions()` / `baseTools()`.
- `surface` — inspect a skill's instructions/tools/resources before composing it.

Explicit trust boundary (no in-process sandbox): discovery reads only frontmatter, `loadTools: false` loads without running the tools module, and skill tools flow through the agent's existing approval/middleware path. Depends on `@gemstack/ai-sdk`.
