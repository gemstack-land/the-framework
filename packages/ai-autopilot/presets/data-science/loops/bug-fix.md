---
name: bug-fix-loop
description: What fires after fixing a wrong result or a pipeline defect.
metadata:
  on: bug-fix
  run: [data-root-cause, regression-test]
---

When the agent fixes a wrong number or a broken pipeline step, confirm the real
cause (a leak, a bad join, a wrong dtype — not just the output that looked off),
then lock it in with a test on a known input and its expected output.
