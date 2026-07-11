---
"@gemstack/framework": minor
---

Add the Projects sidebar to the dashboard: a leftmost nav with Overview (project count plus the most recently active projects), Projects (every registered project with an activation dot and last-activity, from `/api/projects`), and Queue (the open TODO items aggregated across all projects). Selecting a project re-points the project log to `?project=<id>`. The per-project second sidebar and main view come next.
