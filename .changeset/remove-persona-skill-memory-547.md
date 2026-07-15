---
'@gemstack/framework': minor
'@gemstack/ai-autopilot': minor
---

Remove the persona, skill, and project-memory framing. A run's system prompt is now the built-in #326 prompt plus your own `SYSTEM.md`, and nothing else. Nothing is read off disk and appended when the run starts.

A build used to append the personas and skills for its detected stack plus the full contents of the repo's memory files. On one measured 8,852-character build prompt that framing was about 5,000 characters, more than the designed prompt it was wrapping. None of that text was designed; it accumulated. Prompt text nobody reviewed is a defect, not a feature (#547).

Two things fall out of this:

- **The prompt preview is now exact.** The dashboard's "See actual prompt sent" (#520) had to carry a caveat that a build run appends more at run time. It no longer does, so the caveat is gone and what you read before the run is what the agent gets, for every run kind.
- **A build stops being opinionated about the stack.** #545 removed the architect turn, but the personas still hard-instructed a stack ("Default to Prisma"). With both gone, nothing tells the agent what to build on.

Skills and project memory are worth having as designed features later. They are not worth keeping in this shape.

Removed from `@gemstack/framework`: the `memory` / `extensions` / `composeExtensions` options on `runFramework`, the `framing` option on `composeRunSystem` (`RunSystemOptions` is now `SystemPromptOptions`), `loadRepoMemory` / `memoryFraming` / `MEMORY_FILES`, `discoverExtensions`, and the `--compose-extensions` flag. `readProjectSignals` moved to `project.js` and is still exported from the root; preset detection still runs and still narrates `Detected <framework>`.

Removed from `@gemstack/ai-autopilot`: the `personas/` and `extensions/` modules (`definePersona`, `composePersonas`, `personaInstructions`, `personaTools`, `personaAgent`, `personaWorkers`, `personaRoster`, `stackPersonas`, `neutralPersonas`, `presetPersonas`, `defineSkill`, `SkillRegistry`, `composeSkills`, `skillInstructions`, `FrameworkExtension` and its registry). `Preset` is now `{name, framework, signals}`, a pure detector; `DomainPreset` loses `skills` and keeps its loops, prompts, and modes.

`@gemstack/ai-skills` is untouched. It is a different thing (an on-disk `SKILL.md` loader for ai-sdk agents) and is unaffected by any of this.
