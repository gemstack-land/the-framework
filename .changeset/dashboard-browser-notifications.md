---
'@gemstack/framework': minor
---

feat(framework): opt-in browser notifications on the dashboard for run-end and choice gates (#317)

The localhost dashboard can now notify you when a run finishes (or fails/stops) and when a run reaches a `<Choices>` gate that needs your input (e.g. a PLAN.md approval). Opt in via the header bell; it only nudges when the dashboard tab is backgrounded, so a run you are watching stays quiet.
