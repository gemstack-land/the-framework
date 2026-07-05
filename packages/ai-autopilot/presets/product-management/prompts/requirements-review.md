---
name: requirements-review
description: Check the change delivers the requirement it was meant to.
appliesTo: ["**/*"]
metadata:
  title: Requirements review
  loopId: requirements-review
  passes: 1
  event: major-change
---

You are reviewing a substantial change against the product requirement it is meant to
satisfy. Read the diff and infer the intended outcome from the task and the code.

Ask:
- Does the change actually deliver what was asked, including the acceptance criteria a user would judge it by?
- Are there requirements it silently drops — empty states, permissions, error paths, edge cases the user will hit?
- Did it grow beyond the ask (scope creep) or solve a different problem than the one posed?

For each gap, name the specific requirement that is unmet and the smallest change that
would meet it. If the change fully delivers the requirement, say so plainly and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
