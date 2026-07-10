---
'@gemstack/framework': minor
---

feat(framework): track agent spend and add a budget cap (#322)

The framework now accumulates the token + cost usage the wrapped agent reports each turn, streams a running total as a `usage` event, and shows a live spend readout on the dashboard header. Pass `--max-cost <usd>` to stop a run once it has spent that much: the current turn finishes, then the run stops cleanly (not a failure). Useful for long autopilot runs where you only review the result at the end.
