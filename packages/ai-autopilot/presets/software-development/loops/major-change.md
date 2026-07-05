---
name: major-change-loop
description: What fires after a substantial code change.
metadata:
  on: major-change
  run: [code-review, test-coverage, security-review]
---

When the agent lands a substantial change, review it, check it is covered by
tests, then look for security regressions — in that order.
