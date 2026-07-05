---
name: analysis-root-cause
description: Confirm a fix corrects the underlying analytical error, not just the output.
appliesTo: ["**/*"]
metadata:
  title: Analysis root cause
  loopId: analysis-root-cause
  passes: 1
  event: bug-fix
---

You are checking that a fix corrects the **underlying analytical cause** of a defect,
not just the wrong number or figure it produced.

Work backwards from the fix:
- What was the actual error — a wrong formula, a misaligned join, an off-by-one on coordinates, a units or scale mistake?
- Does the fix correct the method, or does it hard-code the expected output and hide the flawed step?
- Could the same error affect other results in the pipeline that draw on the same step?

State the analytical root cause in one or two sentences. If the fix only patches the
output, say what the real correction is. If it fixes the method, confirm it and note any
downstream results that should be recomputed.
