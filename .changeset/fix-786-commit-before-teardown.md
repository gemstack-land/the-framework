---
"@gemstack/framework": patch
---

Never delete work a run left uncommitted (#786). Retiring a finished run removed its worktree with `git worktree remove --force`, so an edit the agent made but never committed was destroyed with the checkout, unrecoverably. Teardown now commits the run's pending work to its own branch first, which outlives the worktree, and keeps the checkout when that commit cannot be made.
