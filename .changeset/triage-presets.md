---
'@gemstack/framework': minor
---

Add the [Do quick-win work] and [Do consensual work] triage presets (#891, #892)

Both read `tickets/*.md`, pick the tickets matching one filter, and append them to
`TODO_AGENTS.md`. They are how the agent queue refills itself from the ticket backlog, where
[Quick wins] refills it from the `.plan.md` companions that already exist.

The pair splits on cost: both are consensual (zero open questions, zero variability), so neither
needs a human, and they differ only in whether the work is cheap. Keeping them apart lets the
queue be refilled with the cheap batch and the significant batch on separate turns rather than in
one indiscriminate sweep.

Both join the auto-PM rotation, which now runs quick-wins, quick triage, consensual triage, then
spike-and-plan: cheapest and readiest first, planning last. Each prompt pins its own session name
and aborts when `the-framework/<SESSION_NAME>` already exists, so a firing that lands while the
previous triage is still in flight does nothing instead of triaging the same tickets twice.

Available as preset buttons in the dashboard.
