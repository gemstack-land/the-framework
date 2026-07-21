---
'@gemstack/framework': minor
---

The UX preset now rates every UI flow and fixes the low scorers on its own (#962)

It used to enumerate findings, show them as choices, and stop at `<AWAIT>` for a human to
pick from. That made it unusable unattended, and the ratings it produced were mostly 10/10,
which is the failure mode where a review reports that everything is fine and changes nothing.

The new prompt demands 100% coverage of the UI flows, a rated reason for each one, a separate
commit per flow it improves, and a closing table of old rating => new rating. It names the
all-10s answer as laziness up front, which is the part that makes the ratings honest. It runs
to completion, so the launcher button is now labelled "UX (auto)"; a gated sibling that offers
its ratings as choices is tracked separately.
