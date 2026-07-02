---
"@gemstack/ai-autopilot": minor
---

Add the decisions ledger: durable project memory so a run stops re-pitching ideas that were already turned down. `DecisionLedger` records rejected ideas and settled choices and answers `consult(idea)` / `wasRejected(idea)` (lexical token-overlap matching, deterministic) before the agent proposes; it round-trips a human-editable `DECISIONS.md` via `loadLedger` / `saveLedger` over a storage-agnostic `LedgerFs` seam (a subset of the runner's `RunnerFs`, with a `nodeLedgerFs()` host adapter). `decisionTools(ledger)` exposes `consult_decisions` + `record_decision` to an agent and `decisionBriefing(ledger)` renders the rejected set as a system-prompt fragment. Verified end-to-end on real disk. First child (#112) of the AI-framework epic (#110); the state layer "the loop" (#113) will consult.
