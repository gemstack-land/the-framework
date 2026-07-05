---
name: data-validation
description: Check the data feeding the change is valid and not leaking.
appliesTo: ["**/*"]
metadata:
  title: Data validation
  loopId: data-validation
  passes: 1
  event: major-change
---

You are checking that the data feeding a change is valid — bad data quietly
produces confident wrong answers. Scope it to the inputs and transforms the change
touched.

Look for:
- **Leakage** — target or future information reaching the features, or the test set influencing training, imputation, or feature scaling fit on the full data.
- **Split integrity** — train / validation / test are separated correctly, and grouped or time-series data does not leak across the boundary.
- **Schema and types** — expected columns, dtypes, and units, with missing values and outliers handled deliberately rather than silently coerced.
- **Distribution** — the sample actually represents the population the claim is about; class imbalance and selection bias are acknowledged.

Name each concrete data risk and the fix. If the inputs are sound, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
