---
'@gemstack/ai-autopilot': minor
---

Preset discovery API: enumerate domain presets so the CLI/UI picker can list and
pick one by name (#254).

`builtinDomainPresets()` loads every domain preset shipped under the package's
`presets/` directory (today just Software Development; new built-ins are picked up
automatically). `loadDomainPresetsFrom(dir)` loads every immediate subdirectory
that holds a `preset.md`, skipping the rest, sorted by name. Pair either with the
existing `selectPreset(list, name)` to pick the user's chosen domain.
