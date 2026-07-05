---
name: root-cause
description: Confirm a fix addresses the root cause, not the symptom.
appliesTo: ["**/*"]
metadata:
  title: Root cause
  loopId: root-cause
  passes: 1
  event: bug-fix
---

You are checking that a bug fix addresses the **root cause**, not just the symptom
that was reported.

Work backwards from the fix:
- What was the actual defect, and why did it produce the observed symptom?
- Does the fix remove the defect, or does it mask it (a guard, a retry, a catch that swallows)?
- Could the same root cause surface elsewhere in the codebase through a different path?

State the root cause in one sentence. If the fix only treats the symptom, say what
the real fix is. If it correctly removes the cause, confirm it and note any sibling
sites worth the same treatment.
