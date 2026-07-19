---
"@gemstack/framework": patch
---

Call them sessions, not runs (#771). The user-facing vocabulary now matches claude.ai/code, so the dashboard, the CLI output and `--help` all say session: the Sessions rail, "Start a session", "Message the session to continue it", "Session started/finished" notifications, "a session is already active for this project", and the rest.

Copy only. No identifier, type, RPC, CLI flag or on-disk name changed: `RunMeta`, `onRuns`, `--run-id`, `run.json` and `runs/` stay as they are, so nothing on anyone's disk moves and no API breaks. "Run" as a verb is left alone too ("run `framework --help`", "npm run dev", "dry run").
