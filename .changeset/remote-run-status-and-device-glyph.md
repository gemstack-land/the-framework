---
"@gemstack/framework": minor
"@gemstack/framework-dashboard": minor
---

Make a remote run's session-list row accurate and legible (#1067). The local in-memory stub for a relayed run now folds every streamed event through the store's own reducer, so it mirrors the device: it shows WAITING while the run is parked on you (not a permanent RUNNING), settles to the right terminal status, and picks up the agent logo and any pending-choice state. The row also gets a small device glyph (with the device name on hover) so a session running on a connected device is distinguishable at a glance from a local one.
