---
'@gemstack/framework': patch
---

Stopping auto PM now stops an in-flight sweep, not just its timer (#983)

`stop()` only cleared the interval, so a sweep already inside its per-project loop kept
going: it finished awaiting the git calls and queue reads, then spawned a run. During
shutdown the daemon quiesces the background services and then clears its live-run map,
so a run started in that window was tracked by nobody. It was never suspended and never
terminated, leaving an orphan process holding a worktree and quota spent on a run that
would never be seen.

The sweep now carries a stopped flag, checked at the top of a tick and again immediately
before a run is started, so the awaited window between the two no longer leaks a run.
