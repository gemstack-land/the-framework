---
'@gemstack/framework': minor
---

Presets target the session they were launched from (#874)

A preset's `what` param defaulted to the literal `this PR`. It now defaults to the session the
preset was launched from, falling back to `entire codebase` when there is no session yet.

`${{ }}` has always been JS-evaluated, but the default value was the one string that never went
through the evaluator, so a `${{ }}` inside it reached the prompt as literal text. Defaults are
now rendered against the same context as the preset body, and that context carries
`session_name`, `presets` and `settings` — so a preset can also point at another preset's file
path, which #881 needs.

In the dashboard, a preset picked from a run page renders against that run's session; the
launcher has no session and gets the codebase-wide default.
