---
"@gemstack/framework": minor
"@gemstack/framework-dashboard": minor
---

Run-view polish for a GitHub Actions target (#1053). A run started with `--run-on actions` now records its target on the run's meta, and the run view reads it: instead of an apparently-stalled live feed (the ActionsDriver replays its transcript in a burst at the end, on a fresh runner per turn), it shows a "running on GitHub Actions, updates arrive when the run finishes" affordance with a clickable link through to the live Actions run (from the `action`/`notice` events the driver emits, which carry the run's `html_url`). The right rail's Browser pane is gated off for an Actions run, since there is no browser on the runner to screencast. A local or remote-device run is unchanged.
