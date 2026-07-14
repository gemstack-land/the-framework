---
"@gemstack/framework": minor
---

Add an "Open on GitHub" button to the dashboard project panel. When the repo has a github.com `origin` remote, the panel shows a one-click link to it (backed by a new `onGithubUrl` read that normalizes the ssh/https remote forms). Hidden when there is no GitHub remote, so it never shows empty.
