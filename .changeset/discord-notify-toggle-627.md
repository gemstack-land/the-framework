---
'@gemstack/framework': minor
---

Per-user Discord toggle for the "needs you" notifications (#627): Discord was env-only (set `DISCORD_WEBHOOK` and it posted). Now a `notifyDiscord` preference (default off) gates the daemon watcher on top of the webhook — the webhook is *where* to post, the preference is *whether* to. It is checked at post time, so the new header toggle (beside the browser bell) takes effect without restarting the daemon, and the watcher keeps its baseline warm while off so flipping it on starts from now rather than blasting the open backlog.
