---
name: bug-fix-loop
description: What fires after a bug fix.
metadata:
  on: bug-fix
  run: [product-root-cause, regression-test]
---

When the agent fixes a bug, confirm the user impact and root cause are understood
and addressed (not just the reported symptom), then lock it in with a regression test.
