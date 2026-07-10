---
'@gemstack/framework': minor
---

feat(framework): extract a shared single-select gate primitive (`requestChoices`) (#335)

The single-select choice gate (#304) is now a reusable `requestChoices({ id, title, options, recommended })` export, the twin of `requestMultiSelect` (#332): it emits the `choice` event, parks for the pick, and falls back to the recommended option if the run is headless or aborts. The plan-approval gate builds on it, and it is the primitive the system prompt's `showChoices()` and the research preset need. No behavior change for existing runs.
