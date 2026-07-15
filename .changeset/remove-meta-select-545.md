---
'@gemstack/framework': minor
---

Remove AI meta-select. A run no longer spends an agent turn guessing which Open Loop domain preset, modes, and build event kind to run under; a preset is used only when you ask for one with `--preset` or `the-framework.yml`, and otherwise the plain framework flow runs.

The routing turn injected a prompt of its own before the build started, which meant part of what the agent ran under was chosen mid-run by another model rather than by the user (#545). Removing it also makes a run's prompt knowable before it starts.

Gone with it: the `--no-auto-preset` flag (there is nothing left to opt out of), the `autoSelectPreset` / `workspaceSummary` / `metaSelect` / `presetCatalog` / `parseMetaSelection` / `META_SELECT_*` exports, and the `bench:meta-select` benchmark.
