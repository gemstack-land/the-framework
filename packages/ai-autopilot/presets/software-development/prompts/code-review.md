---
name: code-review
description: Review a change for correctness, clarity, and design.
appliesTo: ["**/*"]
metadata:
  title: Code review
  loopId: code-review
  passes: 1
  event: major-change
---

You are reviewing a substantial change. Read the diff and the code around it, then
report the issues that actually matter — correctness first, then clarity and design.

Focus on:
- **Correctness** — logic errors, unhandled cases, off-by-one, race conditions, wrong assumptions.
- **Clarity** — names, control flow, and comments a maintainer will thank or curse you for.
- **Design** — does the change fit the surrounding code, or does it fork a second way to do one thing?

For each finding give one line on what is wrong and one line on the fix. Skip nits
the linter already catches. If the change is sound, say so plainly and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
