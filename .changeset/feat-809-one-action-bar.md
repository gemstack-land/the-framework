---
"@gemstack/framework": minor
---

One action bar for the project home and a session (#809). The two pages styled the same facts twice: the project showed a git status row, a session showed its own differently-shaped worktree chip, and the session was missing the repo, folder and editor actions entirely — on the one page where opening a checkout in an editor matters most. Both halves are now shared and take an optional session id: the status reads that session's worktree (adding its size on disk and the PR its branch has), and GitHub, Open folder, Open in editor and Serve all address it.
