---
'@gemstack/framework': minor
---

Dashboard: a stopped session can be deleted. The sessions rail only ever grew — remove-worktree reclaimed a checkout on disk but kept the row, and nothing removed the record. Delete (a trash button beside Remove, which is now a folder-x icon so the two read apart) takes the session out of the dashboard: its run record and event log, and its worktree if one remains. It confirms first, because unlike remove-worktree the replayable history can't be recovered. It deliberately leaves the git branch and its commits, the committed `LOGS.md` line and the conversation record — deleting a branch that may carry merged work or an open PR is not something a trash icon should do silently. It refuses while a run is still going.
