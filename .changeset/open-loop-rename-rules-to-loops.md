---
'@gemstack/ai-autopilot': minor
---

Rename the loop engine's `rules` vocabulary to `loops` (Open Loop, #241).

A loop is a meta prompt, so that is the user-facing unit even though rule logic powers it. `defineLoop` / `defaultLoops` / `Loop` / `LoopSpec` replace `defineRule` / `defaultLoopRules` / `LoopRule` / `LoopRuleSpec`; the engine class is now `LoopEngine` (was `Loop`), created via `createLoopEngine` with `LoopEngineOptions`; and its option key is `loops` (was `rules`). Vocabulary only, no behavior change.
