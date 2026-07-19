---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Auto PM: spike & plan tickets with the quota that would otherwise expire (#685)

When the agent queue has run dry, nothing is running, and every enabled consumption
limit still has half its budget free, the daemon starts a PM run by itself: it spikes
and plans the tickets that have neither yet, so the backlog refills unattended.

Off by default (`autoPm`), and switched on from the Usage panel. The quota gate fails
closed, unlike the per-run guard: no reading means no run.
