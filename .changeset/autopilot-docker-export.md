---
'@gemstack/ai-autopilot': patch
---

Export `DockerRunner`, `DockerRunnerSession`, `dockerAvailable`, and `DockerRunnerOptions` from the package entry.

The runner barrel exported these symbols, but the main entry point omitted them, so the shipped `DockerRunner` adapter could not actually be imported from `@gemstack/ai-autopilot`. They are now reachable alongside `FakeRunner`/`LocalRunner`.
