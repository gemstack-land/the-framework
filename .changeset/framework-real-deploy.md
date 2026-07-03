---
"@gemstack/framework": minor
---

feat: `framework --deploy` actually ships via real deploy targets

Wire ai-autopilot's `cloudflareTarget` / `dokployTarget` into the CLI so
`--deploy cloudflare` / `--deploy dokploy` execute the deploy instead of only
narrating a plan. Adds `--cf-project`, `--dokploy-url`, `--dokploy-app`, a
`hostExecutor` that runs `wrangler` in the agent's workspace, and the `deployWith`
step. Creds come from the environment; targets never throw on missing config
(they report `{ deployed: false }`). `--fake` stays plan-only and deterministic.
