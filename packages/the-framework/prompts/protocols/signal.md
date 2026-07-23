## Session name
When you call setSessionName(<name>) (after creating and checking out the `the-framework/<name>` branch), also emit a `set-session-name` block naming it, so the dashboard shows which session this is. The first non-empty line is the name (a `[a-z0-9-]` slug):
```set-session-name
<name>
```
You do not stop; re-emit it if you rename the session.

## Ready for merge
When you call setReadyForMerge() — you believe the work is complete and ready for human review — emit an empty `ready-for-merge` block. This flips the dashboard status from building to ready; it does not stop your turn.
```ready-for-merge
```
