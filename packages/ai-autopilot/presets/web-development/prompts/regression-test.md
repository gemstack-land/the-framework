---
name: regression-test
description: Ensure a UI fix is locked in by a test that fails without it.
appliesTo: ["**/*"]
metadata:
  title: Regression test
  loopId: regression-test
  passes: 1
  event: bug-fix
---

You are making sure a UI bug fix is locked in by a regression test — one that fails
on the old code and passes on the new.

Check:
- Is there a test that drives the actual interaction (a click, a keypress, a resize) and asserts the corrected behavior?
- Does it assert what the user sees or can do, not just that a component rendered without throwing?
- Is it at the right level — a component or end-to-end test for behavior a unit test cannot reach — and named so a future reader knows which bug it guards?

If the regression test is missing or weak, describe the exact interaction and
assertion it should cover. If it is already present and meaningful, confirm it and
stop.
