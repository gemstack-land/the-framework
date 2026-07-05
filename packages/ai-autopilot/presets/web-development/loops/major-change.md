---
name: major-change-loop
description: What fires after a substantial change to the UI or its routes.
metadata:
  on: major-change
  run: [accessibility-review, performance-budget, web-security]
---

When the agent lands a substantial web change, check it is usable by everyone,
stays inside the performance budget, then look for security regressions in the
routes and markup it touched — in that order.
