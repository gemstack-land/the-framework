---
'@gemstack/framework': minor
---

Auto maintenance: sweep the codebase on a schedule (#882)

Auto PM now fires the [Maintenance] preset (#881) for a project that has not had a codebase-wide
sweep in a week, ahead of its usual quick-wins/spike-and-plan rotation. The sweep only queues
follow-up entries, so the backlog loop still does the work one bounded piece at a time.

This reaches what session-scoped maintenance cannot: a repo that adopted The Framework late has a
whole history no session ever touched.

The schedule is a per-repo `sweptAt` in the existing `.the-framework/maintenance.json`, so it
survives a daemon restart, and it is kept separate from the commit-delta sweep's `reviewedSha` so
the two features cannot reset each other. There is no new setting: it rides the existing `autoPm`
toggle and the quota boundary.
