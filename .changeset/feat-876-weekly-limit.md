---
"@gemstack/framework": minor
---

Add a weekly usage limit, measured against your account's own figure (#876). The other three limits are rolling windows the meter has to derive by diffing readings, which is why a daemon that just restarted has nothing to compare against and reads as untouched however much the week has cost. The agent reports the week absolutely, so this one needs no diffing and survives a restart.

Both gates pick it up, since both already stop at whichever limit is reached: a run pauses on it, and auto PM will not start unattended work past it.

It defaults to 100%, a ceiling rather than a pacing knob, so nothing changes until you lower it. Lowering it is what reserves the rest of the week for yourself.

`ConsumptionLimits` now has a fourth key. A `the-framework.json` written before this keeps working (each limit falls back to its default independently), but TypeScript callers constructing the object literally need to add `week`.
