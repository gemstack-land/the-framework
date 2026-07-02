---
'@gemstack/ai-autopilot': minor
---

Add `dokployTarget` — a second real `DeployTarget`, for self-hosted Dokploy.

`dokployTarget({ serverUrl, applicationId })` triggers a deployment of a pre-configured Dokploy application over the Dokploy API (`POST /api/application.deploy`, `x-api-key` auth). Dokploy builds and serves the app server-side, so — unlike `cloudflareTarget`, which builds and uploads from the session — this target is a simple API trigger and takes no runner session. It never throws: a missing token, a bad response, or a network failure return `{ deployed: false, detail }`. Credentials come from `apiToken` or `DOKPLOY_AUTH_TOKEN` / `DOKPLOY_API_KEY`.

Also fixes the spelling of the deploy target in `DEFAULT_DEPLOY_TARGETS`: `dockploy` → `dokploy` (the real product name).
