---
'@gemstack/ai-autopilot': minor
---

Ship the "Software Development" domain preset (#243).

The first built-in Open Loop preset, authored as a directory of `.md` files:
two loops (major-change -> code-review + test-coverage + security-review; bug-fix
-> root-cause + regression-test), five stack-agnostic prompt bodies, and one skill
pointer. Non-web and user-picked (no dependency detection). Load it with
`softwareDevelopmentPreset()`; `builtinPresetsDir()` points at the shipped
`presets/` directory. Proves the bundle unit end to end.
