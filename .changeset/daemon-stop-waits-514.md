---
"@gemstack/framework": patch
---

Fix `framework stop` returning before the daemon has actually exited (#514). It signalled SIGTERM and removed the state file straight away, so restarting immediately raced the old process for the port: the new daemon hit EADDRINUSE, never reported itself ("the daemon did not come up in time"), and the old one kept serving a stale bundle with no state file left to stop it by. `stopDaemon` now waits for the process to exit before returning, escalating SIGTERM to SIGKILL if a wedged shutdown outlasts the grace period.
