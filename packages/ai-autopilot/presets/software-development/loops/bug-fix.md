---
name: bug-fix-loop
description: What fires after a bug fix.
metadata:
  on: bug-fix
  run: [root-cause, regression-test]
---

When the agent fixes a bug, confirm the root cause is understood and addressed
(not just the symptom), then lock it in with a regression test.
