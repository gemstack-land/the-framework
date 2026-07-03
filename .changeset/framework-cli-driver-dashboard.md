---
"@gemstack/framework": minor
---

feat: @gemstack/framework - The (AI) Framework product shell

The turnkey CLI + localhost dashboard that wraps a coding-agent CLI (Claude Code)
as a black box and drives the ai-autopilot bootstrap flow through it: preset
detect, architect, build, full-fledged loop, deploy. Adds the swappable `Driver`
seam (`ClaudeCodeDriver` + `FakeDriver`), driver-backed bootstrap steps, an event
stream we own, and a `--fake` offline path for CI. `npm i -g @gemstack/framework`.
