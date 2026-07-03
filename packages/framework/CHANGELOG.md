# @gemstack/framework

## 0.2.0

### Minor Changes

- d31a260: feat: preflight checks + `framework doctor`

  A live run now checks its prerequisites first and fails early with a clear fix
  ("`claude` not found - install Claude Code ...") instead of a cryptic mid-run
  spawn error. Adds a `framework doctor` command that reports the checks, and a
  `--skip-preflight` escape hatch. `--fake` never runs preflight (it needs no CLI).

- d72accd: feat: `--serve` gates the loop on the app actually running

  When `--serve <cmd>` is set, the production-grade checklist no longer trusts only
  the agent's review: it adopts the agent's workspace, installs/builds/starts the
  app, and fetches it. A boot failure or a 5xx becomes a blocker the loop hands
  back to the agent to fix, so "production-grade" means it really serves. Adds
  `--serve-install`, `--serve-build`, `--serve-port`, `--serve-path`, the
  `serve` option on `runFramework`, and streams serve progress to the dashboard.

- c4545c2: Surface the live agent session on the dashboard. The wrapped agent's real session id is captured once the first turn returns and streamed as a new `session-update` event, so the dashboard header shows the live session (and the terminal prints it). `--session-link` now accepts a `{sessionId}` template that resolves to a real URL once the id is known; a literal URL still shows immediately.

### Patch Changes

- Updated dependencies [d72accd]
  - @gemstack/ai-autopilot@0.5.0

## 0.1.0

### Minor Changes

- f1e40d4: feat: @gemstack/framework - The (AI) Framework product shell

  The turnkey CLI + localhost dashboard that wraps a coding-agent CLI (Claude Code)
  as a black box and drives the ai-autopilot bootstrap flow through it: preset
  detect, architect, build, full-fledged loop, deploy. Adds the swappable `Driver`
  seam (`ClaudeCodeDriver` + `FakeDriver`), driver-backed bootstrap steps, an event
  stream we own, and a `--fake` offline path for CI. `npm i -g @gemstack/framework`.

- a08a052: feat: `framework` CLI exposes Claude Code's permission mode

  Add `--permission-mode <default|acceptEdits|bypassPermissions|plan>` and
  `--dangerously-skip-permissions`, threaded into `ClaudeCodeDriver`, so a live run
  can build non-interactively. Default stays `acceptEdits`.

- 779b0da: feat: `framework --deploy` actually ships via real deploy targets

  Wire ai-autopilot's `cloudflareTarget` / `dokployTarget` into the CLI so
  `--deploy cloudflare` / `--deploy dokploy` execute the deploy instead of only
  narrating a plan. Adds `--cf-project`, `--dokploy-url`, `--dokploy-app`, a
  `hostExecutor` that runs `wrangler` in the agent's workspace, and the `deployWith`
  step. Creds come from the environment; targets never throw on missing config
  (they report `{ deployed: false }`). `--fake` stays plan-only and deterministic.
