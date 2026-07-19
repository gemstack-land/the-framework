---
"@gemstack/framework": patch
---

Fix a newly started run showing the previous run's logs (#766). A run is resolved to its checkout by looking through the live run state, but for the first seconds of a run there is none: the daemon creates the worktree, spawns the process, and the run writes its `run.json` a beat later. The lookup missed a run that certainly existed and fell back to the project root, whose event log holds an older run's output.

It stuck because a Telefunc Channel resolves its path once, when the client subscribes, so the feed tailed the wrong file for the life of the subscription rather than correcting a moment later.

A run is now resolved by its worktree directory, which is named with the run id and exists before the process starts. A run id with no worktree still falls back to the project root, which stays correct for the non-git fallback path and for a run whose worktree has been removed.
