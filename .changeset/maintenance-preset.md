---
'@gemstack/framework': minor
---

Add the [Maintenance] preset (#881)

A codebase-wide sweep that queues work instead of doing it: for each subset that needs attention
it appends a [Maintainability] and a [Security audit] entry to `TODO_AGENTS.md`, so the backlog
loop does the actual refactoring later, one bounded piece at a time. [Readability] joins them
only under `technical_control`.

It complements the post-merge maintenance block, which only ever sees the changes one session
introduced. A repo that adopted The Framework late has a whole history no session has touched,
and this is what reaches it.

Available as a preset button in the dashboard, and materialized to
`.the-framework/presets/maintenance.md` like the other presets.
