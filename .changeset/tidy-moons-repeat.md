---
'@gemstack/framework': patch
---

Stop a status check from unregistering a running daemon. `daemonStatus()` deleted the state file whenever it named a process that was gone, and the daemon only ever wrote that file at startup, so one check against a stale pid left a live daemon invisible for the rest of its life: `framework stop` could not find it, and `framework --daemon` kept spawning a replacement that died on the already-bound port. The read now reports a stale record instead of deleting it, a running daemon re-asserts its record if it goes missing, and the record is written atomically so a torn read is never mistaken for a dead daemon.
