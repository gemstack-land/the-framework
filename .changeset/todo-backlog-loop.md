---
'@gemstack/framework': minor
---

The backlog loop (#323): after the build settles, the run consumes the agent's own TODO backlog (`TODO_<slug>.agent.md`, or the flat `TODO.md`) one entry per turn until it is empty. When a dashboard can answer, the loop gates before each entry ("start the next item?"), so autopilot consumes the backlog unattended and autopilot-off pauses per item. Caps make it safe overnight: the budget/Stop signal ends any turn, `--max-todo-items` bounds the run (default 25), and two no-progress items stop the loop. `--no-todo-loop` opts out.
