---
'@gemstack/framework': minor
---

Read the account's subscription quota on demand via the agent's own `/usage` command, as `Driver.readQuota()`. Reports the percentage of each window consumed (session, week, per-model week), which is what a consumption limit needs and what the per-turn rate-limit telemetry could not give. Costs no tokens, and the CLI reaches Anthropic with its own credentials, so The Framework never handles the user's token.
