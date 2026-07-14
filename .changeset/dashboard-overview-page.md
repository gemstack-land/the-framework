---
"@gemstack/framework": minor
---

Move the cross-project Overview out of the first sidebar and into a proper dashboard page. The sidebar is now just an "Overview" nav item plus the project list, so it reads as a simple switcher. Selecting Overview (or opening the dashboard with no project picked) shows an at-a-glance landing: KPI tiles (projects, active runs, open TODOs, total runs), a two-week run-activity chart, how past runs ended, what the agent is working on now, the TODO backlog, and a projects table. It is backed by a new `onDashboard` read (a projection of the same run.json / runs/ / TODO files), so nothing new is stored.
