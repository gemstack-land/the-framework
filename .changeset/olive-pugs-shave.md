---
'@gemstack/framework': major
---

Presets are one catalog instead of thirteen modules, and the notifier keys plus the
preference defaults have a single home shared with the dashboard.

Breaking, public API. The 56 per-preset exports (`RESEARCH_PRESET_NAME`,
`RESEARCH_PARAMS`, `RESEARCH_PROMPT_TEMPLATE`, `renderResearchPrompt`, and the same
four for each of the other thirteen presets) are replaced by one `presets` record
plus `LAUNCHER_PRESETS`: `renderResearchPrompt(what)` becomes
`presets.research.render(what)`, and `RESEARCH_PRESET_NAME` becomes
`presets.research.name`. `definePreset` now takes a spec object rather than three
positional arguments.

Also removed: `nodeGhPrLister`, `nodeGhBranchPrLookup` and `nodeGhPrLookup`, replaced
by `ghPrView` / `ghPrList` in the new `gh` module; `startInterventionWatcher` /
`startActivityWatcher` / `InterventionTracker` / `ActivityTracker`, replaced by
`startKeyedWatcher`; and `postDiscord`, now `postInterventionsDiscord` beside the type
it formats.

Fixes a latent bug while doing so: `RunMeta.updatedAt` was stamped with the run's start
time on every event, so everything that orders by recency (the overview, the activity
feed, the interventions queue) was sorting on a constant.
