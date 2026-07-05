---
name: product-root-cause
description: Confirm a fix addresses the real user impact and root cause, not the symptom.
appliesTo: ["**/*"]
metadata:
  title: Product root cause
  loopId: product-root-cause
  passes: 1
  event: bug-fix
---

You are checking that a bug fix addresses the **root cause and the real user impact**,
not just the symptom that was reported.

Work backwards from the fix:
- What did the user actually experience, and what underlying defect produced it?
- Does the fix remove that defect, or does it patch the one report while the same problem reaches users through another flow?
- Who was affected and how badly — is anything needed beyond the code fix (a backfill, a comms, a follow-up)?

State the root cause and the user impact in one or two sentences. If the fix only treats
the symptom, say what the real fix is. If it correctly removes the cause, confirm it and
note any sibling flows worth the same treatment.
