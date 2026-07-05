---
name: data-provenance-review
description: Check the data's origin, versioning, and integrity are trustworthy.
appliesTo: ["**/*"]
metadata:
  title: Data provenance review
  loopId: data-provenance-review
  passes: 1
  event: major-change
---

You are checking that the data behind a change can be trusted and traced. Scope the
review to the inputs the change relies on.

Look for:
- Origin and versioning — is it clear where each dataset came from, which version, and how to obtain it again?
- Integrity of transformations — do filtering, normalization, and merging steps preserve the data's meaning, or quietly drop or duplicate records?
- Governance — reference genomes/annotations pinned, units and identifiers consistent, and any consent, licensing, or PHI constraints respected.

Report each concrete provenance risk with where it shows up and the fix. If the data is
well-sourced and traceable, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
