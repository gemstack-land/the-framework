---
"@gemstack/the-framework": minor
---

Reclaim a session's worktree once its work has landed.

A run that failed or was stopped keeps its checkout so you can read what it was holding, and nothing ever took those back, so a machine accumulated one full checkout per such session forever. The daemon now sweeps the registered projects every ten minutes and removes the checkouts whose branch has landed.

Only the checkout goes. The branch, its commits, and the session's row and replayable log are kept, so everything this reclaims is a `git worktree add` away. That is what makes it safe to do without asking.

A branch counts as landed on either of two signals, because neither alone is enough. `git branch --merged` is the stronger one, since it proves the commits are reachable from the local base, but it only holds for a merge that kept them: a squash or rebase merge rewrites the commits, so the branch never becomes an ancestor and the signal never fires. A merged PR closes that gap. A closed-unmerged PR does not count as landed, since the checkout of rejected work is the one you are most likely to still want.

The sweep is conservative wherever the answer is unclear: a live run keeps its checkout, and so does a branch that no longer exists or one whose state cannot be read.

`framework worktrees sweep` runs the same pass on demand, next to the existing `prune` (which removes every checkout whose session is no longer running, landed or not).
