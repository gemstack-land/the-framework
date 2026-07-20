---
'@gemstack/framework': minor
---

Runs no longer outlive the daemon that spawned them. A shutting-down daemon stops the runs it started and records each one as resumable; the next daemon picks them back up in the same worktree, continuing the same agent conversation. Previously a stopped daemon left every in-flight run running on `ppid 1`, holding a worktree and sometimes a headless browser, with nothing left that knew about it. Runs suspended more than a day ago are dropped rather than resumed, and a run the daemon merely steers rather than spawned is left alone.
