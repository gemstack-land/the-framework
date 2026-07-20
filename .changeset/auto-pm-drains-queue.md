---
'@gemstack/framework': patch
---

Auto PM now drains the agent queue as well as filling it (#855)

Auto PM only ever put work into `TODO_AGENTS.md`, and nothing unattended took it out
again: the backlog loop is a phase inside a run a human started, and auto PM's own runs
go down the prompt path, which never reaches it. So the queue filled once and every
later tick refused because it was no longer empty, and the daemon went quiet for good.

A tick that finds open entries now starts a run for the first one instead of standing
down, and goes back to harvesting quick-wins and planning tickets once the queue is dry.
A queue that cannot be read at all is still a refusal. The refusal reason is logged each
tick, so a wedged sweep no longer looks the same as a healthy idle one.
