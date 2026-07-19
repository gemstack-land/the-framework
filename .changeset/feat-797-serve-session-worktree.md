---
"@gemstack/framework": minor
---

Serve a session's own worktree (#797). Preview was keyed by project and always booted the project's checkout, so pressing Serve inside a session showed you an app built from code that session never wrote, and two live sessions shared one preview. A session now serves the worktree it is working in, the project home keeps serving the main checkout, and the two run side by side. Stop and status are addressed the same way, the servable-app picker lists what the session's branch actually has, and a worktree's preview is stopped before its checkout is removed.
