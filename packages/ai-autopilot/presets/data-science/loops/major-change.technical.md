---
name: major-change-loop-technical
description: The major-change loop under Technical Control — leaner, the analyst drives the depth.
metadata:
  on: major-change
  run: [reproducibility-review]
  conditions: technical
---

Technical Control mode: the analyst is hands-on, so the loop only auto-runs the
reproducibility pass — the one that protects everyone downstream — and leaves data
and methodology depth to them. Overrides the base major-change loop when
`technical` is active.
