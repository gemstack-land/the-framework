---
'@gemstack/framework': patch
---

fix(framework): narrate the auto-preset routing turn so the dashboard is not blank at the start of a run (#310)

A preset-less live run first does a real Claude routing turn to auto-select a domain preset. The dashboard was started only after that turn, so its first few seconds looked dead. The dashboard now starts before the routing turn and the turn narrates a log line into it.
