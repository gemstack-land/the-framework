---
"@gemstack/framework": minor
---

Add event-stream projections for the dashboard's run overview: `architectPlan`, `decisionLedger`, `loopStatus`, and `sessionInfo` derive the chosen stack + rationale, the decisions ledger, the production-grade loop status, and the live session from a `FrameworkEvent[]`. They plus `formatFrameworkEvent` are re-exported from a new browser-safe `@gemstack/framework/client` subpath (no Node imports), so the dashboard renders the rich run view — the stack/PROS-CONS card, decisions, loop status, and a human-readable event log instead of raw JSON — across the live view, past-run replay, and the relay watch view.
