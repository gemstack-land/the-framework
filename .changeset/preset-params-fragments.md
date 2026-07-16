---
"@gemstack/framework": minor
---

Standardize the preset prompts on the `${{ tf.params.what }}` fragment syntax (the same the system prompt uses) and retire the bespoke `<PARAM:name>` primitive. `render<Name>Prompt(what)` is unchanged and produces byte-identical output; the removed exports (`renderPresetPrompt`, `PARAM_PATTERN`, `extractParamNames`, `unfilledParams`, `PresetParamError`, `PresetParam`, `PresetParamOptions`) had no other consumers. Prereq for #326's post-merge preset `filePath` entries.
