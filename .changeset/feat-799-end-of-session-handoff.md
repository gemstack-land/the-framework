---
'@gemstack/framework': minor
---

End of session: surface the branch and diff, offer push and PR (#799)

A finished session now reports what it produced and what to do with it. The dashboard shows the branch the work landed on, its commits, its changed files and the line counts, and offers Push branch and Open PR as buttons rather than describing them. A session that changed nothing says so instead of showing an empty branch.

The read is branch-addressed rather than worktree-addressed, so it survives teardown: a clean run's worktree is removed when it finishes, and a checkout-based read then falls back to the project root and reports the project's own branch as though it were the session's. The branch each run left its work on is now recorded in its run meta while the worktree still exists, since the #326 prompt lets the agent name its own branch and neither derivation is reliable after the fact.

New: `onRunHandoff`, `sendPushBranch` and `sendOpenPullRequest` RPCs, and `readRunHandoff` / `pushRunBranch` / `openRunPullRequest` with injectable git and gh seams. Degrades rather than fails when there is no remote, no `gh`, or no git repo.
