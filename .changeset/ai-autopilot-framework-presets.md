---
"@gemstack/ai-autopilot": minor
---

Add the web-app preset seam: framework-specific knowledge selected by detecting the app's framework, on top of the agnostic core. A `Preset` bundles a framework's personas with the signals that identify it; `detectFramework` scores a project's dependencies + files (deps weigh more than files) and `PresetRegistry.select` picks the preset (falling back to the flagship when nothing matches). Ships two built-ins — `vikePreset` (flagship) and `nextPreset` — plus a new `nextPageBuilder` persona (App Router + React Server Components). `presetPersonas(preset)` returns the framework page builder followed by the shared, framework-neutral personas (`sharedPersonas`: the universal-orm modeler + intent-UI designer), so only the page builder changes between frameworks while the rest of the stack stays put and prompts stay neutral. One shared core; a new framework is a new `Preset`, not a runtime fork. Closes #115.
