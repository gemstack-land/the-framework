---
'@gemstack/framework': minor
---

Show the real prompts on the dashboard (#343). The framework now emits the exact system prompt it runs the agent under, the #326 block plus any persona / skill / memory framing, as a `system-prompt` event at session start (both the direct-prompt path and the full build path). A new "Prompts sent to Claude Code" panel renders it alongside each turn's user prompt (harvested from the `driver` `start` events already in the stream), so the normally-hidden prompt is fully visible for transparency. Prompt text renders as inert text, never markup. Read-only; nothing is gated on it.
