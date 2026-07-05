---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': minor
---

Domain preset runs can now pick a build event kind, so a preset's bug-fix loop actually fires. A run chooses it with `runFramework({ buildEvent })` / the `framework --kind <name>` flag, and a preset can declare its own default via `preset.md` `metadata.event` (surfaced as `DomainPreset.defaultEvent`). Precedence: run choice > preset default > `major-change`; an event the preset has no loop for still falls back to the built-in checklist.
