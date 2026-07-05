---
name: ui-root-cause
description: Confirm a UI fix addresses the real cause, not the visible symptom.
appliesTo: ["**/*"]
metadata:
  title: UI root cause
  loopId: ui-root-cause
  passes: 1
  event: bug-fix
---

You are checking that a UI bug fix addresses the **real cause**, not the pixel that
looked wrong.

Work backwards from the fix:
- What was the actual defect — a wrong state transition, a race between render and data, a bad breakpoint, a stale effect dependency — and why did it show up the way it did?
- Does the fix remove that cause, or does it paper over it (a hard-coded value, a `setTimeout`, a `!important`, a magic z-index)?
- Could the same cause surface on another screen size, another route, or another component sharing the state?

State the root cause in one sentence. If the fix only treats the symptom, say what
the real fix is. If it correctly removes the cause, confirm it and note any sibling
views worth the same treatment.
