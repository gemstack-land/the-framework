---
'@gemstack/framework': patch
---

Fix the Claude Code driver reporting `costUsd: 0` when a result line carries token usage but no price. `DriverUsage.costUsd` is documented as omitted (never `0`) when there is no price, because the budget cap reads `0` as "this turn was free" rather than "the price is unknown" (#540). The driver now omits the field in that case, matching the Codex driver and the type's own contract. Claude runs that do report a price are unchanged.
