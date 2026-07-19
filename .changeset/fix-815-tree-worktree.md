---
'@gemstack/framework-dashboard': patch
---

Scope the file tree to the active worktree (#815). The tree listed the project root and dotted it with the project root's git status, while the action bar directly above it resolved the session's worktree for the branch, Serve and open folder. Both reads already took a `runId` (#738); the tree now passes the selected one, and polls the file list so a file the session creates shows up.
