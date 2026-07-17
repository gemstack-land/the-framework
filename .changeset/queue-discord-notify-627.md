---
'@gemstack/framework': minor
---

Discord notifications for the Queue's "needs you" list (#627): when `DISCORD_WEBHOOK` is set, the daemon watches the interventions queue and posts a message when a new PR lands — so you are notified even with no dashboard open. The PRs already open when the daemon starts are folded into a baseline (no start-up blast); the env var is the opt-in. Complements the in-browser notifications from the same queue.
