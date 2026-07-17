---
'@gemstack/framework': minor
---

Browser notifications for the Queue's "needs you" list (#627): when a new PR lands on the interventions queue, the dashboard fires a browser notification that opens the PR on click. A bell in the header toggles it and requests permission; the preference (`notifyBrowser`, on by default) persists with the others. Existing PRs at page load are folded into a baseline, so you are only told about items that appear while you are watching. (Discord delivery and the paused-run trigger are follow-ups.)
