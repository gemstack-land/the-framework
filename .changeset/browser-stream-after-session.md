---
'@gemstack/framework': patch
---

Announce the browser preview's port on the run's first `session` event instead of before it. The dashboard renders only the tail from the last `session` event, so the announcement was sliced out of the run's view and the `browser preview` line never appeared in the feed.
