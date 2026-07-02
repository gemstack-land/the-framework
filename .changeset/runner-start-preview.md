---
'@gemstack/ai-autopilot': minor
---

Runner seam: long-running processes + reachable previews (boot-and-serve).

`RunnerSession.start(command)` launches a long-running command (a dev server) in the background and returns a `RunnerProcess` handle (`{ command, exit, stop() }`) — unlike `exec`, which awaits the command to finish. `preview({ waitMs })` now waits for the port to accept connections before resolving, so the URL is live on return. A `start_server` runner tool exposes this to agents.

`LocalRunner` implements it for real: `start` spawns in its own process group so `stop()` (and `dispose()`) kill the whole tree; `preview` polls the port. `FakeRunner` mirrors it for tests. This is the contract every sandboxed adapter (Docker / WebContainer / Flue) must satisfy, and it's what makes "produce a running app" reachable end to end.
