---
'@gemstack/framework': minor
---

Queue "needs you" now surfaces paused runs, not just PRs (#636, part of #624): a live run that stopped mid-flight to ask a question shows up alongside open PRs in the Overview card, the sidebar badge, and the #627 browser + Discord notifications. `RunMeta` folds a `pendingChoice` from the `choice`/`choice-resolved` events, and `Intervention` gains a second `kind: 'awaiting'` — the card jumps into that project to answer, and the Discord message reads "awaiting your answer" with a link back to the dashboard.
