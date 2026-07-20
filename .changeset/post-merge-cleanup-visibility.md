---
'@gemstack/framework': patch
---

Report what the post-merge cleanup step did (#835). It used to decline for five reasons, four of them silently, and say so on stdout in the one case that spoke up. A dashboard-started run is spawned with `stdio: 'ignore'`, so turning on Post-merge cleanup and getting nothing was indistinguishable from it having run. The outcome is now a real `on-before-mergeable` event (queued, incomplete, or skipped with the reason), and it fires before the run's event log is archived so it survives into the run's history.
