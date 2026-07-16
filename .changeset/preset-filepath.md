---
"@gemstack/framework": minor
---

Post-merge TODO entries now carry the preset's `filePath` instead of a bare preset name (#326). The entry reads `Apply .the-framework/presets/<name>.md with tf.params.what set to "changes introduced by <session>"`, and `installProject` materializes the presets into `.the-framework/presets/*.md` so that path resolves to a real file the picked-up agent opens. Closes the fidelity gap where the queue sent a preset name and the agent had to guess the prompt. The materialized presets are gitignored (regenerated on install, tracking the framework version). New: `PRESETS`, `PRESET_DIR`, `presetFilePath`, `presetContext`, `materializePresets`.
