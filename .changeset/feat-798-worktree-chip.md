---
"@gemstack/framework": minor
---

Show a session's worktree in its action bar (#798). Every session runs in its own git worktree, and the dashboard said so nowhere: the git status bar reads the project, so a session's branch, its uncommitted work, and the directory holding both were invisible from the one view about that session. The action bar now carries a chip with the branch, a marker when the checkout is dirty, and — once the run is no longer live — what that worktree costs on disk, next to the Remove button that offers to reclaim it. Clicking opens that checkout in your editor rather than the project's.
