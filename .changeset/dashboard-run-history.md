---
'@gemstack/framework': minor
---

feat(framework): browse a project's run history in the dashboard (#303)

The dashboard now has a left sidebar listing a project's past runs (intent, status, session link); clicking one replays that run's projection in the main view, and "Back to live" returns to the current run. Each finished run is archived under `.framework/runs/<id>.jsonl` + `.framework/runs/<id>.json` (a crash that skips the final flush is archived on the next run), and served over `GET /api/runs` and `GET /api/runs/<id>`. Single project only. Closes #303.
