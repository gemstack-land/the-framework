---
name: test-coverage
description: Check the change is covered by meaningful tests.
appliesTo: ["**/*"]
metadata:
  title: Test coverage
  loopId: test-coverage
  passes: 1
  event: major-change
---

You are checking that a substantial change is covered by tests that would actually
catch a regression — not coverage for its own sake.

Ask:
- Does every new branch and edge case have a test that fails if the behavior breaks?
- Are the tests asserting behavior, or just that the code ran without throwing?
- Is anything important only exercised by a happy-path test?

Name the specific untested paths and, for each, the one test worth adding. If the
change is a pure refactor with existing coverage, say so and stop.
