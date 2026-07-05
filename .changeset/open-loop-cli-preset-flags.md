---
'@gemstack/framework': minor
---

CLI: `--preset <name>` runs a build under an Open Loop domain preset, with
`--autopilot` / `--technical` mode flags (#256).

`--preset` resolves a shipped domain preset by name (via `builtinDomainPresets` +
`selectPreset`) and hands it to `runFramework`, so its loops, prompts, and skills
frame the build. `--autopilot` / `--technical` activate the preset's `conditions`
variants (applied at load time and narrated). An unknown preset name is a usage
error that lists the available presets; the mode flags note when given without a
preset. Additive: a run with no `--preset` is unchanged.
