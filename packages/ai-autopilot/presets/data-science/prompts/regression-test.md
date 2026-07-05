---
name: regression-test
description: Ensure a data fix is locked in by a test on a known input and output.
appliesTo: ["**/*"]
metadata:
  title: Regression test
  loopId: regression-test
  passes: 1
  event: bug-fix
---

You are making sure a data fix is locked in by a test — one that fails on the old
code and passes on the new.

Check:
- Is there a test that runs the fixed step on a small, known input and asserts the expected output (a row count, an aggregate, a schema, a value)?
- Would it have caught the original bug — does it exercise the exact case that was wrong, including the edge (empty group, all-null column, boundary date)?
- Is it deterministic and fast enough to run in the pipeline, with the fixture committed rather than pulled from a live source?

If the test is missing or weak, describe the exact input and expected output it
should assert. If it is already present and meaningful, confirm it and stop.
