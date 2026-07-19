---
"@gemstack/framework": minor
---

Watch and steer a run in its own worktree (#749). #738 made concurrent runs visible; they were still not watchable or steerable, because the live event stream and the control channel were addressed by project while a run reads and writes inside its worktree (#736). The feed for a worktree run was therefore empty, and Stop, mid-run messages and choice picks were written to a log nothing was tailing.

`onEvents` now takes an optional run id and tails that run's own `events.jsonl`, so selecting one run or another shows that run's output rather than the same empty feed. `sendStop`, `sendMessage` and `sendChoice` take the run id too and append to that run's `control.jsonl`, which is the file the run tails. Both resolve through the shared `resolveRunPath`, so an unknown or finished run id falls back to the project root, and omitting the id keeps the pre-#736 behavior for a run that has no worktree.

The dashboard threads the selected run through the feed subscription and every steering control, and resubscribes when you switch runs.
