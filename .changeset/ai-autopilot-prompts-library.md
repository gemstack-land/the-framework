---
"@gemstack/ai-autopilot": minor
---

Add the built-in prompts library: the stack-aware prompt *bodies* the loop dispatches, shipped as data. Eight markdown bundles under `prompts/` (review TLDR + thorough, code-quality, security, refactor, UX, QA, knowledge-base) that already know Vike + universal-orm, loaded with `builtinLibrary()` / `loadPromptsFrom(dir)` into a `PromptLibrary` and parsed via `@gemstack/ai-skills`' frontmatter (a contributor edits prose, not code). `loopPromptsFor(library, makeAgent)` materializes them into loop prompts so `defaultLoopRules()` ids resolve to real bodies (a fresh agent per pass); `promptInstructions` composes a body with the decisions briefing (#112) and `renderTask` turns a `LoopEvent` into the worker's task. Closes the turnkey wire across #111 / #112 / #113. Verified end-to-end against the built package. Child #111 of the AI-framework epic (#110).
