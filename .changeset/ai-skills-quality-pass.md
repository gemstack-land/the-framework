---
"@gemstack/ai-skills": minor
---

Quality + docs pass for ai-skills:

- `SkillRegistry.discover()` no longer aborts the whole scan when a single `SKILL.md` is unreadable or malformed; the bad bundle is skipped and the rest are still indexed. Pass `discover(root, { onError })` to observe what was skipped. This restores the documented "index hundreds of skills safely" contract.
- Skill `name` is now validated at parse time against `[a-zA-Z0-9_-]` instead of being silently mangled later at compose time, so invalid names fail fast with a clear message.
- `load()` on an undiscovered name now lists the available skill names (or hints to call `discover()` first).
- `loadSkill()` distinguishes a missing `SKILL.md` from an unreadable one.
- Deduplicated the internal `fileExists`/`isDirectory` helpers into a shared module.
- README: clarified that the tools module is loaded compiled (`tools.js`/`.mjs`/`.cjs`, not `tools.ts`), and added a direct `loadSkill()` usage example.
