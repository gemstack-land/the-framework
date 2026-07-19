---
"@gemstack/framework": minor
---

Messaging a stopped run continues that run instead of opening a new one (#762). Sending a message to a run that had ended spawned a fresh run carrying the old session id: the agent conversation continued, but the history showed an unrelated-looking second row, so one thing you asked for looked like two.

The follow-up is still its own process; what changed is where it writes. `sendStart` takes the run to continue, and the daemon reuses that run's id, its worktree and its branch rather than allocating new ones, restoring the run's archived history into the checkout when teardown (#737) had already removed it. The run then reopens its own log instead of truncating it, keeping its original intent and pass count and flipping back to `running` under the new process. One run, one row, one branch.

Falls back to starting a new run whenever continuing is not possible: no worktree to attach, no branch left, or nothing archived to restore.
