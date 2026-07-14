---
"@gemstack/framework": minor
---

Add a git-status line to the dashboard project panel: the active branch, a clean/dirty indicator, and the linked PR (number, state, link). Backed by a new `onGitStatus` read; branch and dirty come from git, the PR is a best-effort `gh` lookup that degrades to nothing when gh is missing/unauthed or there is no PR. Hidden when the project is not a git repo.
