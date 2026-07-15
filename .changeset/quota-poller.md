---
'@gemstack/framework': minor
---

Add `QuotaPoller`: keeps the account's quota reading fresh on a slow timer and feeds the consumption meter. Backs off when the agent's usage fetch is refused rather than retrying into the penalty window, gives up on an authoritative failure, and keeps the last good reading across a transient one.
