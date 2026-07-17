---
'@gemstack/framework': minor
---

Add an agent picker to the dashboard (#650). The Start form can now choose the coding agent that drives the run — Claude Code or Codex — beside the model, wiring the existing `--agent` flag. It persists as a preference (`agent`, validated to the known set) and maps to a run's `--agent` (only non-default `codex` emits a flag). The agent and model pickers now render as dropdowns matching the Presets menu, and the "New preset" panel spans the full width.
