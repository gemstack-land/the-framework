---
'@gemstack/ai-autopilot': minor
---

Runner: `DockerRunner` — the first sandboxed adapter, running agent-authored code in a container.

`DockerRunner` boots each workspace as a container via the `docker` CLI (no npm dependency), so untrusted, agent-authored code runs isolated from the host: its own filesystem, process space, and — with `preview` — a published port mapped to an ephemeral host port. It satisfies the same `Runner` contract as `LocalRunner` (fs / exec / start / preview / dispose), so it drops in behind the seam unchanged: `new DockerRunner({ image?, previewPort?, previewHost? })`.

Where `LocalRunner` runs commands unsandboxed on the host (trusted dev/CI), `DockerRunner` is the one to reach for when the code is untrusted. It requires a running Docker daemon and the `docker` CLI on `PATH`; the default `node:20-alpine` base image carries `node`/`npm` and a POSIX shell. `dockerAvailable()` reports whether a daemon is reachable so callers (and the test suite) can skip cleanly when it isn't.

WebContainer and Flue remain the still-parked sandboxed adapters (#109).
