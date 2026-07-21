# @gemstack/ai-skills

## 0.2.3

### Patch Changes

- Updated dependencies [46c79a6]
- Updated dependencies [f6efb7d]
- Updated dependencies [f38f80b]
  - @gemstack/ai-sdk@0.6.0

## 0.2.2

### Patch Changes

- 6f7cf23: Fix four orchestration correctness bugs and tidy the package surface.

  - `exec()` now runs in its own process group and settles even when a background grandchild outlives the shell. Previously a command like `npm install` that left a daemon behind kept the inherited stdio open, so `close` never fired and the call never settled, blowing past its own `timeoutMs`.
  - `serveCheck` bounds its health-check fetch. A dev server that accepts the connection but never answers used to hang the bootstrap pass loop forever, since neither the fetch nor the process exit could settle.
  - A blocking loop chain (`continueOnError: false`) now stops at an unknown prompt id instead of running past it. A typo'd or unregistered id silently bypassed a gate that a _throwing_ prompt would have stopped.
  - `runPool` no longer reports truncation when the budget is met exactly by the final item, which surfaced as a false `stoppedEarly` / `budget-exceeded` with `skipped: 0` on a plan that ran to completion. Worker errors also propagate through `allSettled`, so one failure cannot orphan its siblings into unhandled rejections.

  Also: exported `AgentSynthesizerOptions` (the only `agent*` factory whose options were unnameable), dropped three dead imports in `bootstrap/steps.ts`, corrected two doc comments that claimed one shipped domain preset when five ship, removed a doc comment describing a function that had moved, and fixed `clean` scripts that left `dist-test/` behind (stale compiled tests cause phantom failures).

- Updated dependencies [6f7cf23]
- Updated dependencies [6f7cf23]
- Updated dependencies [da79ec8]
  - @gemstack/ai-sdk@0.5.1

## 0.2.1

### Patch Changes

- Updated dependencies [dbc8b3a]
- Updated dependencies [1b2ba93]
  - @gemstack/ai-sdk@0.5.0

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
