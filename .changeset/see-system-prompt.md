---
'@gemstack/framework': minor
---

Let the user see the system prompt. Under the prompt editor, a `▶ See actual prompt sent` toggle shows the built-in prompt in full, with the `Vanilla` checkbox renamed to `Disable system prompt` (nobody knows what "Vanilla" means; the persisted `vanilla` key is unchanged). The preview renders through `composeRunSystem`, the same function a run composes with, so the toggles are shown doing what they really do.

The event log now renders the run's `system-prompt` event in full too. That event has always carried the exact text handed to the agent, and the dashboard was reducing it to a char count and dropping the rest, so the true prompt was already reaching the browser and being thrown away. That is the one that is byte-exact for a build run, where the repo's memory files, personas and skills are read off disk at run time.

Reading the user's `SYSTEM.md` moves to `system-prompt-file.ts`, leaving `system-prompt.ts` free of Node imports so the composition can be imported in a browser. A test walks the compiled client barrel's import graph and fails if anything reachable from it imports `node:*`.
