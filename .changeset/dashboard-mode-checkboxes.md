---
'@gemstack/framework': minor
---

feat(framework): show the active Open Loop modes as read-only checkboxes on the dashboard (#272)

When a run builds under a domain preset, the dashboard now renders a Modes panel with the run's modes as checkboxes ([x] technical / [ ] autopilot), so the policy driving the build is visible beside the stack and loop panels. Backed by a new `modes` framework event (`OPEN_LOOP_MODES` is the canonical mode ordering, shared with the meta-select router); a run with no preset emits nothing and shows no panel. The event persists with the run, so `--resume` rehydrates the panel too.
