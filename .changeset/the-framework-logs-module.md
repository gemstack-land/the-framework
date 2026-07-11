---
'@gemstack/framework': minor
---

New `.the-framework/LOGS.md` project-log module (#378): `appendLog`/`readLogs` keep a human-readable markdown log of every loop, prompt, and build in a project, with `renderLogEntry`/`parseLogs` as the pure core over the same StoreFs seam as the run store. Parsing is forgiving: a malformed entry is skipped, never thrown. Standalone for now; the run-lifecycle wiring and dashboard UI land in follow-up issues.
