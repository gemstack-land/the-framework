---
"@gemstack/framework": minor
---

Add a git-worktree lifecycle module (`addWorktree` / `listWorktrees` / `removeWorktree` / `pruneWorktrees`), the foundation for running multiple tasks concurrently on one repo (#453). Each run will get its own checkout under `.the-framework/worktrees/<runId>` so concurrent runs never fight over the working tree. This slice is the isolated, unit-tested plumbing only; the daemon wiring, per-worktree concurrency, and dashboard changes land in the sibling #453 issues, so nothing changes at runtime yet.
