---
"@gemstack/framework": minor
---

Make the dashboard multi-project on the read side: `GET /api/projects` lists the registered projects (from the registry) with a per-project summary (name, activated, last activity), and `?project=<id>` on `/api/logs`, `/api/runs`, `/api/runs/<id>`, and `/api/docs` reads that project's data (an absent id keeps the daemon's own workspace, single-project back-compat). The daemon auto-registers its own workspace on boot when it is activated, so the Projects list is populated for the common single-project case. Live event streaming and per-project run start/stop stay single-project for now. Adds `ProjectSummary` / `ProjectsProvider` / `summarizeProject` / `defaultProjectsProvider`.
