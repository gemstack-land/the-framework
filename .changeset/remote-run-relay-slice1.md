---
"@gemstack/framework": minor
"@gemstack/framework-dashboard": minor
---

feat(framework): run a session on a connected device via a server-side relay (#1067, slice 1)

Picking a saved device in the "Run on" gear now makes it a true run target: you stay on this dashboard, submit, and the session runs on the remote device and streams its events back into the current run view. A device row no longer navigates the browser; it selects the device in place (the token stays a per-browser secret, memory-only, never persisted).

Under the hood the local daemon relays the run: it POSTs the run to the remote daemon's new `/_relay/start` (authenticating with the device token as the `fw_daemon` cookie, no Origin) and fetch-streams the remote's `/_relay/events` back into the local run view over the normal same-origin channel. The browser never talks cross-origin and the token never leaves the two daemons. Both `/_relay/*` endpoints are fronted by the same #1051 token guard.

Slice 1 is submit + live events. The remote run executes in the device's own home checkout, and the diff, PR, push/handoff, and browser screencast panels show a "not available for remote runs yet" placeholder; those (and per-project remote targeting) land in later slices.
