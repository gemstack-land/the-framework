---
'@gemstack/framework': minor
---

Report an agent's tokens when it reports no price. `DriverUsage.costUsd` is now optional: tokens are what every agent reports, a price is what only some do. Codex reported real token counts that we were dropping on the floor, and now surfaces them; a run with no price shows `tokens: 13,570 (5 out)` rather than nothing at all, and never a `$0` that would read as free. Claude runs are unchanged and still show their spend line.

The spend cap only ever fires on a reported price, so it stays Claude-only and the CLI says so rather than implying otherwise. We deliberately do not invent prices from a model table: that number would go stale silently, and under a subscription nobody is billed per token anyway. What a subscription actually spends is quota, which the consumption limits gate on.
