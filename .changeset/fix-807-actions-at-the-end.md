---
"@gemstack/framework": patch
---

Group a session's actions at the end of its action bar (#807). Serve, Stop, Remove and Open session sat at the start of the row, interleaved with the worktree chip, and since each one is conditional the row shifted under the cursor as a session moved through its life. What the session is now reads at the start of the bar; what you can do to it sits at the end, in one place.
