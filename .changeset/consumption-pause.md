---
'@gemstack/framework': minor
---

Pause a run when a consumption limit is reached. `runFramework` takes a `consumptionGate` consulted between turns; a reached limit stops the run cleanly (like the budget cap) and leaves a `Resume <session name>` entry on the workspace's backlog, so a later run picks the work back up. An unreadable quota carries on rather than stopping the work.
