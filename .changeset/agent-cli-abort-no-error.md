---
'@gemstack/framework': patch
---

Fix the agent-CLI runner emitting a spurious `error` event after a run is aborted. On abort the turn rejects and settles, but the killed child process still fires `close` afterward, and the close handler emitted an `error` (and would have emitted `result`) telemetry event before checking whether the turn had already settled. The dashboard event stream saw a phantom agent error after a clean Stop. The close handler now returns early once the turn has settled, so an abort produces exactly one outcome.
