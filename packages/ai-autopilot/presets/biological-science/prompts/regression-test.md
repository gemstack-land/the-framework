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

You are making sure a fix is locked in by a regression test — one that fails on the old
code and passes on the new, ideally on a small known case with an expected result.

Check:
- Is there a test on a fixture or known input that reproduces the defect and would fail without this fix?
- Does it assert the corrected values, not just that the analysis ran to completion?
- Is it placed and named so a future reader knows which error it guards against?

If the regression test is missing or weak, describe the exact case and expected result
it should cover. If it is already present and meaningful, confirm it and stop.
