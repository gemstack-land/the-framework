---
"@gemstack/ai-autopilot": minor
---

Add bootstrap's deploy phase and the `DeployTarget` adapter seam. The final phase decides the rendering mode (SSR/SSG/SPA) and the deploy target (Dockploy vs Cloudflare), narrates the plan, and hands it to a `DeployTarget` — the same pattern as the runner seam. `agentDeploy` is the default step (an `ai-sdk` agent decides `{ render, target, reason }`, normalized against the allowed sets); `planOnlyTarget` is the v1 default that decides and narrates without shipping, and `FakeDeployTarget` backs tests. v1 decides + narrates only; real Dockploy / Cloudflare adapters implement `DeployTarget` and are infra-gated follow-ups, so bootstrap never does a blind deploy. The deploy step is optional and its outcome rides on `BootstrapResult.deploy`. Closes #123.
