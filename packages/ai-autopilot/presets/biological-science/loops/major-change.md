---
name: major-change-loop
description: What fires after a substantial change to an analysis or pipeline.
metadata:
  on: major-change
  run: [experimental-design-review, data-provenance-review, statistical-rigor-review]
---

When the agent lands a substantial change, check the experimental design and controls,
that the data's provenance is trustworthy, then that the statistics are rigorous — in
that order.
