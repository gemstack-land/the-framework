---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Auto PM: harvest quick-wins out of the plans we already have (#773)

Adds a [Quick wins] preset — "look at all tickets/\*\*.plan.md and add all quick-wins to
TODO_AGENTS.md" — and puts it in the auto-PM cycle ahead of [Spike & plan], so an idle
machine harvests the plans it has before writing more.

That closes the loop: tickets become plans (#685), plans become queued work (#773), and
the backlog loop drains the queue.
