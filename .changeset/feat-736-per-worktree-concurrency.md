---
"@gemstack/framework": minor
---

Run concurrently on one project, each run in its own git worktree (#736). A dashboard-started run is now given a worktree under the project's `.the-framework/worktrees/<runId>`, on a `the-framework/run-<runId>` branch, and spawned with that as its `--cwd`. Because the runs no longer share a working tree, the one-run-per-project refusal (#393) is gone: the cap is unbounded, and Start is only refused for a duplicate of the same checkout. The user's own checkout is never touched, so a run no longer commits their uncommitted work to get started.

Three supporting pieces. The daemon allocates the run id up front and passes it as `--run-id`, so the worktree directory and the run recorded inside it are one string. A fresh worktree has no `node_modules` (it is gitignored), so the parent checkout's dependency trees, workspace packages included, are symlinked in rather than copied or reinstalled. And the run renames its branch to `the-framework/<sessionName>` once the agent names the session, leaving it on the run-id name if the agent already branched itself.

A project that cannot be given a worktree (not a git repo, or any git failure) falls back to running in the main checkout, and keeps its previous limit of one run at a time.
