---
'@gemstack/ai-autopilot': minor
---

Add the Open Loop bundle unit: a domain preset = {loops, prompts, skills} (#242).

This is the keystone that ties the three data types the framework already ships
separately into one selectable, composable thing. Author one in code with
`defineDomainPreset`, or load one from a directory of `.md` files (`preset.md` +
`loops/`, `prompts/`, `skills/`) with `loadDomainPreset`. `composeDomainPresets`
merges several into one (loops concatenate; prompts and skills merge by id/name,
later wins), so presets-of-presets falls out; `selectPreset` picks the user's
domain by name. Kept distinct from the framework `Preset` detector in `presets/`
(skipped for the Open Loop MVP) by naming this `DomainPreset`.
