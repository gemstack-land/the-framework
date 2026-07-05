---
name: reproducibility-review
description: Check someone else could reproduce this result from the repo alone.
appliesTo: ["**/*"]
metadata:
  title: Reproducibility review
  loopId: reproducibility-review
  passes: 1
  event: major-change
---

You are checking that a data-science change is reproducible — that a colleague with
the repo and documented access could rerun it and get the same result.

Look for:
- **Determinism** — random seeds set where results depend on them; no reliance on unpinned ordering or wall-clock.
- **Pinned environment** — dependencies and versions locked, not "whatever is installed".
- **Data provenance** — the data source is named and reachable (path, query, or fetch step), not a stray local file that only exists on one machine.
- **Runnable end to end** — the pipeline runs from a documented entry point, not a notebook with cells executed out of order or hidden manual steps.

Report each concrete gap and the fix. If the work reproduces cleanly, say so and
stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
