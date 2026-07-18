---
"@gemstack/framework": patch
---

Seed a run's intent (its prompt) when the run store opens, so the dashboard's Runs list labels `prompt` and `research` runs with their prompt instead of "(no prompt)". Only build runs emitted a `bootstrap` scope event carrying the intent; a direct-prompt or research run had none, so its row showed no label. A build run still refines the seeded intent via its scope event; research with no "what" seeds the same "this PR" default the log title uses.
