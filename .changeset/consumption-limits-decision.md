---
'@gemstack/framework': minor
---

Add the consumption-limit decision layer: `ConsumptionMeter` tracks the account's weekly quota meter over time, and `consumptionStatus` reports where the session / 5h / daily limits stand and which one is reached. Handles the weekly reset, reports partial coverage honestly, and fails open when the quota can't be read.
