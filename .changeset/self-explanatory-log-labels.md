---
'@gemstack/framework': patch
---

Dashboard: the session log labels each row with a plain word instead of its internal event name (#1035). The badge used to show the raw event kind, so a turn of the AI read `DRIVER`, the paused state read `SETTLED`, and the spend row read `USAGE`. These now read `AGENT`, `WAITING`, and `COST`, and the resume-link row reads `RESUME`. Kinds that were already clear are unchanged.
