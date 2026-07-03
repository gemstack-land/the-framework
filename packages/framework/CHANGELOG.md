# @gemstack/framework

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
