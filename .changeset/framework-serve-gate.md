---
"@gemstack/framework": minor
---

feat: `--serve` gates the loop on the app actually running

When `--serve <cmd>` is set, the production-grade checklist no longer trusts only
the agent's review: it adopts the agent's workspace, installs/builds/starts the
app, and fetches it. A boot failure or a 5xx becomes a blocker the loop hands
back to the agent to fix, so "production-grade" means it really serves. Adds
`--serve-install`, `--serve-build`, `--serve-port`, `--serve-path`, the
`serve` option on `runFramework`, and streams serve progress to the dashboard.
