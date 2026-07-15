---
'@gemstack/framework': minor
---

Capture the agent's rate-limit telemetry. Claude Code reports where the account's subscription quota stands on every turn of its `stream-json` output, and the parser was dropping it. It now surfaces as a `rate-limit` driver event carrying the status, the quota window, and when that window resets, so it persists and reaches the dashboard like any other driver event. New `DriverRateLimit` type.
