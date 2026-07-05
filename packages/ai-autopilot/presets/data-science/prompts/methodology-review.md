---
name: methodology-review
description: Check the method actually supports the conclusion.
appliesTo: ["**/*"]
metadata:
  title: Methodology review
  loopId: methodology-review
  passes: 1
  event: major-change
---

You are checking that the method behind a change supports the conclusion it claims.
A correct implementation of the wrong method is still wrong.

Ask:
- **Metric fit** — does the evaluation metric match the goal (accuracy on imbalanced data, a threshold chosen after seeing the test set, a proxy standing in for the real outcome)?
- **Baseline** — is the result compared against a simple baseline, or reported in a vacuum where any number looks good?
- **Overfitting** — is the reported performance on held-out data, or is the model being judged on what it trained on?
- **Statistical validity** — is the effect distinguishable from noise (sample size, variance, multiple comparisons), and are the assumptions of the test or model met?

State whether the conclusion holds. Name each methodological flaw and what would
make the claim sound. If the method is appropriate, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
