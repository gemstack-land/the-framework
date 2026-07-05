---
name: experimental-design-review
description: Check the analysis rests on sound experimental design and controls.
appliesTo: ["**/*"]
metadata:
  title: Experimental design review
  loopId: experimental-design-review
  passes: 1
  event: major-change
---

You are reviewing a substantial change to a research analysis or pipeline for sound
experimental design. Scope the review to what the change touches.

Ask:
- Are there appropriate controls and baselines, and is the comparison the change makes actually valid?
- Is the sample size and power adequate for the claim, or is the effect being read from noise?
- Are confounds, batch effects, and selection bias accounted for — or silently baked into the result?

For each weakness, name what undermines the design and the smallest change that would
make the result trustworthy. If the design is sound, say so plainly and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
