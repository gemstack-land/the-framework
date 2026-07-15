---
'@gemstack/framework': minor
---

Turn the consumption limits on for real runs. `startConsumptionGuard` composes the poller and the limits into the gate a run consults, the CLI reads the limits from the user's preferences and wires it into both run paths, and the direct prompt path gained the same pause the build path got. A driver that can't report a quota leaves the run ungated.
