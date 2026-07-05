---
name: statistical-rigor-review
description: Check the statistics are honest and correctly applied.
appliesTo: ["**/*"]
metadata:
  title: Statistical rigor review
  loopId: statistical-rigor-review
  passes: 1
  event: major-change
---

You are checking that the statistics in a change are sound and honestly reported. Scope
the review to the analysis the change introduces or alters.

Ask:
- Is the test appropriate for the data — its distribution, independence, and the hypothesis being asked?
- Is multiple testing corrected for, and are p-values, effect sizes, and confidence intervals reported rather than a bare significance stamp?
- Any sign of p-hacking, HARKing, or a result that would not survive the analysis being pre-registered?

Report each concrete statistical problem with where it occurs and the correct approach.
If the analysis is rigorous and honestly reported, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
