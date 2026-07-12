---
"@gemstack/framework": minor
---

Per-project daemon runs + one daemon per machine (#393). Dashboard-started runs, Stop, and choice picks now carry the viewed project id, so the daemon spawns each run with that project's `--cwd`, steers it through that project's own control log, and guards one run per project. Daemon liveness moved from a per-workspace `.the-framework/daemon.json` to a single global file beside the registry (`$XDG_CONFIG_HOME/the-framework-daemon.json`), so `framework` and `framework stop` in any repo find the same daemon. Per-project live event streaming is folded in with the dashboard rebuild (#405).
