---
'@gemstack/framework': patch
---

Auto PM now starts runs with the project's own settings (#858)

An unattended run was started with no options at all, so it ignored the agent, the
model, and every other per-project setting a launcher-started run would have honoured.
A project configured for Codex had auto PM running Claude.

The preferences to run-options mapping moved out of the dashboard client into the
framework's browser-safe entry, so the daemon and the launcher now share one copy of it
rather than two that can drift. `--unattended` is still forced on regardless of what the
preferences say: that is a property of nobody watching, not something to configure.
