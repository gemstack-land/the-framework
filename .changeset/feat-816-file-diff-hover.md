---
'@gemstack/framework-dashboard': minor
'@gemstack/framework': minor
---

Hover a changed file in the tree to see its diff (#816). Adds `onFileDiff`, the first read that takes a caller-supplied path, guarded by `safeRepoPath`: repo-relative only, no traversal, no leading dash, never into `.git`. Tracked files diff against `HEAD` so a staged change still shows, an untracked file renders as all-added, and a patch is cut at 500 lines and says so.
