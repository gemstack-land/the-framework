---
name: regression-test
description: Ensure a fix is locked in by a test that fails without it.
appliesTo: ["**/*"]
metadata:
  title: Regression test
  loopId: regression-test
  passes: 1
  event: bug-fix
---

You are making sure a bug fix is locked in by a regression test — one that fails on
the old code and passes on the new.

Check:
- Is there a test that reproduces the reported behavior and would fail without this fix?
- Does it assert the corrected user-facing outcome, not just that the code ran?
- Is it placed and named so a future reader knows which bug it guards?

If the regression test is missing or weak, describe the exact case it should cover.
If it is already present and meaningful, confirm it and stop.
