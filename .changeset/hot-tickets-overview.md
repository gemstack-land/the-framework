---
"@gemstack/the-framework": minor
---

Add a "Hot tickets" overview to the dashboard.

The Overview now has a cross-project glance at the tickets that matter right now, in three lanes: In progress (tickets the agent has planned or spiked), Up next (high priority, not started yet), and Queued (the rest of the open backlog). Each row names its project and jumps into it when selected.

It pools every project's `tickets/`, so it is a projection of the same files the agent plans from, polled so it stays live. Empty lanes collapse to a single header line, so an import-heavy repo where everything sits queued still reads as designed.
