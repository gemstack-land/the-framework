---
'@gemstack/framework': minor
---

Transparent mode (#625): a coarse master off-switch that makes a run identical to plain `claude -p <prompt>` — the "only pick what you need" requirement, at its extreme. Turn it on and the wrapped agent runs fully raw: no framework system prompt, no AWAIT/SIGNAL emit protocols, no consumption guard, no dashboard, no TODO loop.

Available at all three tiers: the `--transparent` flag, a `the-framework.yml` `transparent: true` key (per project), and a `transparent` user preference surfaced as the "Transparent" toggle in the dashboard's run options (it overrides the other option toggles, and the "Actual prompt" preview correctly shows an empty channel).

This also closes the gap where `--vanilla` was advertised as "fully transparent" but still injected the AWAIT/SIGNAL protocols into the system channel: `--vanilla` keeps that emit contract (so the agent can still drive the dashboard's gates), and `--transparent` is the new switch that drops everything for a genuinely raw run. `composeRunSystem` now returns an empty string under transparent, the single place the whole system channel is assembled.
