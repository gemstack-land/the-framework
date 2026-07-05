---
name: major-change-loop
description: What fires after a substantial change to a pipeline, model, or analysis.
metadata:
  on: major-change
  run: [reproducibility-review, data-validation, methodology-review]
---

When the agent lands a substantial data change, check someone else could reproduce
it, that the data feeding it is valid, then that the method actually supports the
conclusion — in that order.
