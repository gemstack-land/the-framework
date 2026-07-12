---
"@gemstack/framework": minor
---

The new dashboard can now start a run over Telefunc (#405). A `sendStart` telefunction reaches the daemon's own `startRun` closure through the Telefunc request context, so it runs in-process with the one-run-per-project busy guard intact (a second start returns `busy`). Served at `/_telefunc` alongside the read + steer RPCs, same-origin guarded.
