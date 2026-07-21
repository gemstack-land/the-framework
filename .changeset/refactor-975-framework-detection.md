---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': patch
---

**Breaking (`@gemstack/ai-autopilot`):** the framework-detection exports are renamed so they no
longer collide with the user-facing domain presets.

Two unrelated subsystems were distinguished only by a directory's singular-vs-plural: `src/preset/`
(the Open Loop domain bundles, `{loops, prompts}`) and `src/presets/` (framework detection). Both
were re-exported side by side from the one entry point, so `definePreset` and `selectPreset` read
like a pair while being from different subsystems. "Preset" now means the user-facing domain bundle
only, which is what the shipped root `presets/` markdown and the dashboard already meant by it.

`src/presets/` moves to `src/framework-detection/` (internal), and the exports rename:

| Before | After |
| --- | --- |
| `definePreset` | `defineFrameworkPreset` |
| `Preset` | `FrameworkPreset` |
| `PresetSpec` | `FrameworkPresetSpec` |
| `PresetSignals` | `FrameworkPresetSignals` |
| `PresetScore` | `FrameworkPresetScore` |
| `PresetRegistry` | `FrameworkPresetRegistry` |
| `PresetError` | `FrameworkPresetError` |
| `builtinPresets` | `builtinFrameworkPresets` |
| `builtinPresetRegistry` | `builtinFrameworkPresetRegistry` |

`detectFramework`, `vikePreset`, `nextPreset`, `FrameworkSignals` and `FrameworkDetection` are
unchanged: they were already unambiguous. The domain-preset exports (`defineDomainPreset`,
`selectPreset`, `composeDomainPresets`, `loadDomainPreset`, `builtinDomainPresets`,
`builtinPresetsDir`, ...) are unchanged.

No behavior change. As a side effect `@gemstack/ai-autopilot` no longer exports a `definePreset`
that clashes with the unrelated `definePreset` in `@gemstack/framework`.
