---
name: performance-budget
description: Check the change stays inside the web performance budget.
appliesTo: ["**/*"]
metadata:
  title: Performance budget
  loopId: performance-budget
  passes: 1
  event: major-change
---

You are checking that a web change does not quietly blow the performance budget.
Scope it to what the change adds to the page and its network cost.

Ask:
- **Bytes** — new dependencies, large imports pulled into the client bundle, or a heavy library added for one small use.
- **Core Web Vitals** — does the change hurt LCP (a big hero image or blocking font), CLS (content that shifts as it loads), or INP (a handler that blocks the main thread)?
- **Images and media** — sized, lazy where below the fold, and served in a modern format rather than a multi-megabyte original.
- **Requests** — waterfalls, unbatched calls, or data fetched on the client that could be fetched on the server.

Name each concrete regression with its cost and the cheaper alternative. If the
change is within budget, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
