---
"@gemstack/framework": minor
---

The daemon can now serve the new Vike + Telefunc dashboard bundle (#405). Opt in with `FRAMEWORK_DASHBOARD=next` (serves the prerendered SPA at `/`, with the legacy `page.ts` at `/legacy`) or `FRAMEWORK_DASHBOARD=legacy` (mounts the Telefunc surface at `/_telefunc` while `page.ts` stays at `/`). Unset keeps today's behavior exactly. The dashboard's read + steer RPCs and the live-event Channel are served in-process at `/_telefunc` (same-origin guarded), backed by a new `@gemstack/framework/dashboard-rpc` subpath; `starting` a run over Telefunc lands next.
