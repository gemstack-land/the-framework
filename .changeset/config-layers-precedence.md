---
'@gemstack/framework': minor
---

Config layers now resolve by precedence, so a layer can turn a mode off (#841)

The layers used to combine with OR: a flag could only ever turn a mode on, and
`the-framework.yml` could only ever turn one on. Neither could say `false`, so a repo
that committed `autopilot: true` gave every run in it autopilot with no way back.

The layers now feed one resolve helper where the nearest layer that *set* a key wins and
a layer that said nothing does not participate. Absent stays absent, so an existing setup
resolves exactly as before; the change is that an explicit `false` in a nearer layer now
wins. `--no-autopilot`, `--no-technical`, `--no-vanilla` and `--no-transparent` give a run
that nearer `false`, and the startup line now narrates which layer won each key
(`◆ config: preset=software-development (the-framework.yml), autopilot=off (flag)`).
