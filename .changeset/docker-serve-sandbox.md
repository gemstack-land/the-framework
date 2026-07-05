---
'@gemstack/framework': minor
---

feat(framework): run the `--serve` verification in a Docker sandbox (#229)

`framework --serve ... --sandbox docker` now boots the app inside a throwaway container instead of on the host: the source is copied in, deps install and the dev server runs in the container, and the health check hits a mapped port. So agent-authored code never installs or runs on your machine to be verified. `--sandbox local` (the default) is unchanged — it adopts the host cwd in place.

This is the first slice of #229: only the serve verification is sandboxed; the build itself still runs on the host (the container is re-seeded with the latest source before each check). Requires a reachable Docker daemon — a run that asks for the sandbox without one fails fast with a clear message; `--sandbox docker` without `--serve` is a no-op note. `runFramework` gains `sandbox` and an injectable `runner` option.
