---
'@gemstack/framework': minor
---

Discord delivery for the "New activity" notifications category (#627): the daemon now also watches the run activity feed and posts to Discord when a run starts or finishes, so the default-off activity category reaches you with no dashboard open — the same path the interventions watcher uses for the "needs you" queue. Double-gated at post time so the header toggles take effect without a daemon restart: both the category (`notifyNewActivity`) and the Discord method (`notifyDiscord`) must be on, on top of a `DISCORD_WEBHOOK` being set. The runs already going when the daemon starts are folded into a baseline (no start-up blast). Completes the browser + Discord matrix for both notification categories.
