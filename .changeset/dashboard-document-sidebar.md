---
'@gemstack/framework': minor
---

feat(framework): document sidebar on the dashboard, rendering the run's PLAN.md / TODO.md (#319)

The localhost dashboard now surfaces the `PLAN.md` and `TODO.md` the agent writes at the workspace root (via the anti-lazy-pill) in a right sidebar, rendered as markdown with a sticky tab nav to jump between them. A new `GET /api/docs` endpoint reads the surfaced docs (fixed filenames, gated on the workspace `cwd` like `/api/runs`); the sidebar polls it so a plan written mid-run appears, and stays hidden when there are no docs.
