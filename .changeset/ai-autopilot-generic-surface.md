---
"@gemstack/ai-autopilot": minor
---

Generalize the surface stream to be event-type generic. `EventStream<E>`, `AutopilotHandle<E, R>`, and `launchAutopilot<E, R>` now take the event (and result) type as parameters, defaulting to the supervisor's `SupervisorEvent` / `SupervisorRun` so every existing supervisor surface is unchanged. This lets bootstrap (and any future surface) stream its own narration events and return its own result over the same replayable, detached transport. Closes #120.
