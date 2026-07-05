---
name: bug-fix-loop
description: What fires after a bug fix in the UI.
metadata:
  on: bug-fix
  run: [ui-root-cause, regression-test]
---

When the agent fixes a UI bug, confirm the real cause (a state, a race, a wrong
breakpoint — not just the pixel that looked wrong), then lock it in with a
regression test that would have caught it.
