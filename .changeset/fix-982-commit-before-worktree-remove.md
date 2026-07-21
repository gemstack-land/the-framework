---
'@gemstack/framework': patch
---

Removing a retained worktree no longer destroys the uncommitted work it was kept for (#982)

A worktree is only retained when its session failed or was stopped, which is exactly when the
checkout is still holding an uncommitted diff. Both surfaces that offer to remove one, the
`framework worktrees rm` verb and the dashboard's Remove button, went straight to a removal that
falls back to `git worktree remove --force`, so the work was deleted with the directory and there
was nothing left to recover it from.

Both now commit the checkout to the session's own branch first, the way the daemon's teardown
already does, and refuse the removal when that commit fails, keeping the checkout instead. The
two surfaces are now one implementation, so the session-still-running refusal, the unknown-session
check and the new commit-first behaviour are identical on both. Removing a session that has no
worktree now reports that instead of the dashboard reporting success.
