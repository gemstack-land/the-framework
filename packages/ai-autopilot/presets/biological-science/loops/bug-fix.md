---
name: bug-fix-loop
description: What fires after fixing a defect in an analysis or pipeline.
metadata:
  on: bug-fix
  run: [analysis-root-cause, regression-test]
---

When the agent fixes a defect, confirm the underlying analytical cause is understood
and corrected (not just the wrong number it produced), then lock it in with a
regression test on a known case.
