---
"@gemstack/framework": patch
---

Fix a newly started run briefly showing the previous run's log (#774). On Start the shell followed live until the poll surfaced the new run's row, and during that window the feed subscribed with no run id, which resolves to the project root and its older output. The right log replaced it a moment later, so the run flashed the wrong content first.

The shell already gets the run id back from Start, so the feed now subscribes to that run immediately and there is no window addressed at the project root. The same id drives the run's controls, so an immediate Stop or message also reaches the right run rather than the project.
