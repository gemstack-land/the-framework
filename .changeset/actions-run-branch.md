---
"@gemstack/framework": patch
---

Let the GitHub Actions run target (#1050) read back a run's work and continue on it (#1085). `claude-code-action@v1` leaves its `branch_name` output empty for a `workflow_dispatch` agent run, so the driver never learned the branch the agent pushed: `readCode` failed and a follow-up turn started over on `main`. The driver now names the branch itself (`claude/framework-<session>`) and passes it to the workflow, which pushes the run's work there and records it, so the diff view works and each turn builds on the last.
