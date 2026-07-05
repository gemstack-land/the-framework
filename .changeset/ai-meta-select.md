---
'@gemstack/framework': minor
---

feat(framework): AI meta-select — auto-pick the Open Loop domain preset, modes, and build event kind from the prompt + workspace (#270)

A live run with no `--preset` (and none in `the-framework.yml`) now infers the best-fit domain preset, its modes (technical / autopilot), and the build event kind from what you asked for and the project you are in, then runs under it. So `framework "add a login page"` in a web app picks Web Development on its own. `--no-auto-preset` opts out (plain framework flow); `--fake` stays deterministic. Any failed or empty pick falls back to the plain flow, so the auto-pick never blocks a run.
