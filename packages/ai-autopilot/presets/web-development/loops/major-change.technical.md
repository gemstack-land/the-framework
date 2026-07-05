---
name: major-change-loop-technical
description: The major-change loop under Technical Control — leaner, the developer drives the depth.
metadata:
  on: major-change
  run: [accessibility-review]
  conditions: technical
---

Technical Control mode: the developer is hands-on, so the loop only auto-runs the
accessibility pass — the one most often skipped by hand — and leaves performance
and security depth to them. Overrides the base major-change loop when `technical`
is active.
