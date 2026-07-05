---
'@gemstack/framework': minor
---

Run a build under an Open Loop domain preset (#251).

`runFramework({ preset, modes })` now accepts a user-picked domain preset
({loops, prompts, skills}). Its skills (and their personas) frame every phase of
the run alongside the detected framework skill, the selected domain and active
modes are narrated, and its loops + prompts are materialized into a driver-backed
`LoopEngine` exposed as `result.loop` (each pass is a fresh driver prompt). The
new `driverLoopPrompts` bridge does the materialization. Opt-in and additive: a
run with no preset is unchanged. Driving the exposed loop as a run phase is the
follow-up (#252).
