---
"@gemstack/framework": minor
---

Add a "Browser" toggle to the dashboard Start form so `--browser` (give the agent a real browser via chrome-devtools-mcp, #452) is reachable from daemon/dashboard-started runs, not just the CLI. Mirrors the Post-merge cleanup pref: a `browser` preference flows to `StartRunOptions.browser` and on to the `--browser` flag.
