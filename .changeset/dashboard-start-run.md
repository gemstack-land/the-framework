---
'@gemstack/framework': minor
---

Start runs from the daemon dashboard (#345): a prompt textarea + `POST /api/start` that spawns `framework "<prompt>" --no-dashboard` as a detached child, with a one-run-at-a-time guard. The started run streams into the page via the tailed event log and is steerable (gates + Stop) through the control channel.
