---
'@gemstack/framework': minor
---

A run with `--browser` now serves a live view of the agent's browser. The run prints a preview URL; opening it shows what the agent sees, and clicks, typing, scrolling, and navigation go back to that page — so when the agent parks on an `await-browser` gate at a login wall or a captcha, a human can actually deal with it. The view follows the agent when it switches tabs. It binds to loopback only, and no frame is written to disk or into the run's event log.
