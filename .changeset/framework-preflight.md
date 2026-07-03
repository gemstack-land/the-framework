---
"@gemstack/framework": minor
---

feat: preflight checks + `framework doctor`

A live run now checks its prerequisites first and fails early with a clear fix
("`claude` not found - install Claude Code ...") instead of a cryptic mid-run
spawn error. Adds a `framework doctor` command that reports the checks, and a
`--skip-preflight` escape hatch. `--fake` never runs preflight (it needs no CLI).
