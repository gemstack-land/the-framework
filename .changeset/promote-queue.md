---
'@gemstack/framework': patch
---

Auto PM lands its queue in the checkout instead of re-doing the work forever (#852)

A run works in its own git worktree, so the queue it wrote lived on a branch the
sweep never reads. The checkout still looked empty, and every cooldown auto PM
re-derived the same entries onto a new branch, spending real quota each time.

The daemon now copies `TODO_AGENTS.md` from a finished run's branch into the
project checkout, committing only that path. The agent never writes to the
checkout, and a checkout with uncommitted queue edits is left alone.
