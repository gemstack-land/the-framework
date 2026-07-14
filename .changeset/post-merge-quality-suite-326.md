---
"@gemstack/framework": minor
---

Add the post-merge quality suite (#326): when a run signals `setReadyForMerge()`, optionally fire the maintainability, readability, and security-audit passes over the same workspace. Enabled per run by the new `--post-merge` CLI flag, or from the dashboard's Global options via a "Post-merge cleanup" toggle (persisted as the `postMergeQuality` preference, mapped to `--post-merge` on the spawned run). The three passes run **sequentially** — they edit and commit the same git tree, so concurrent writers would race on the index lock; worktree-isolated parallelism is a follow-up. Each pass is a plain `framework prompt` child carrying no `--post-merge`, so a quality pass never triggers its own suite. Off by default.
