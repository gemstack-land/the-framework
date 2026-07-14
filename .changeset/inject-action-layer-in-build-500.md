---
"@gemstack/framework": patch
---

Fix the #326 action-layer protocols being dropped from a build run's system prompt when the built-in prompt is off. `runFramework` nested the `AWAIT_PROTOCOL` and `SIGNAL_PROTOCOL` blocks inside the built-in-prompt branch, so a `--vanilla` build (or `antiLazyPill: false` via `the-framework.yml`) with no `SYSTEM.md` injected neither — leaving the agent with no way to emit `set-session-name` / `ready-for-merge`, so `setReadyForMerge()` and the `--post-merge` quality suite silently never fired. The protocols are now appended unconditionally, matching the direct-prompt path (`runPrompt`).
