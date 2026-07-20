---
'@gemstack/framework': minor
---

Add `framework worktrees` for the checkouts sessions leave behind. `framework worktrees` lists them with the session's status, size on disk and branch; `framework worktrees rm <sessionId>` removes one, refusing while that session is still running; `framework worktrees prune` removes every one whose session is no longer running. Until now this cleanup existed only as a per-row button in the dashboard, so it could not be scripted, and a machine that had been running sessions for a while accumulated checkouts with no way to clear them from a terminal.
