---
'@gemstack/ai-autopilot': minor
---

Add `cloudflareTarget` — the first real `DeployTarget` adapter for bootstrap mode.

`cloudflareTarget({ session, ... })` ships the built app to Cloudflare via the `wrangler` CLI, run inside the build's runner session: install, build, then deploy to **Workers** (SSR) or **Pages** (SSG/SPA), reporting the live URL wrangler printed. Credentials come from `apiToken`/`accountId` (or `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`) and are passed to `wrangler` through the command environment, so they work whether the session is local or a container. It never throws — a missing token, failed build, or failed deploy return `{ deployed: false, detail }` so the final phase narrates rather than crashing.

Wire it on the existing seam: `agentDeploy(deployer, { target: cloudflareTarget({ session, projectName }) })`.
