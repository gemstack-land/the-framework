---
name: metrics-review
description: Check the change is instrumented so its success can be measured.
appliesTo: ["**/*"]
metadata:
  title: Metrics review
  loopId: metrics-review
  passes: 1
  event: major-change
---

You are checking whether the success of this change can actually be measured once it
ships. A feature you cannot measure is a feature you cannot tell is working.

Ask:
- Is the key user action the change introduces or alters emitted as an event or otherwise observable?
- Is there a way to tell the intended outcome apart from failure — a funnel, an error signal, a before/after?
- Would a launch review a week later have the data to say whether this worked, or only anecdotes?

Name the specific signals that are missing and, for each, the one event or metric worth
adding. If the change is already measurable, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
