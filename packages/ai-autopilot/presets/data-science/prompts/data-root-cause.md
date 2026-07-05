---
name: data-root-cause
description: Confirm a data fix addresses the real cause, not the wrong number.
appliesTo: ["**/*"]
metadata:
  title: Data root cause
  loopId: data-root-cause
  passes: 1
  event: bug-fix
---

You are checking that a fix to a wrong result or a broken pipeline step addresses
the **real cause**, not the output that looked off.

Work backwards from the fix:
- What was the actual defect — a bad join multiplying rows, a wrong dtype or unit, a silent NaN, an off-by-one window, a leak — and why did it produce the observed number?
- Does the fix remove that cause, or does it patch one output (a hard-coded correction, a `dropna` that hides the real gap, a clamp)?
- Could the same cause corrupt other columns, other date ranges, or a downstream table drawing from the same step?

State the root cause in one sentence. If the fix only corrects the visible number,
say what the real fix is. If it removes the cause, confirm it and note any sibling
outputs worth rechecking.
