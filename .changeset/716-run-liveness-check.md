---
"@gemstack/framework": minor
---

Self-heal a run whose process died without writing its `end` event (#716). A crash, `kill -9`, or the machine sleeping used to leave `.the-framework/run.json` stuck at `status: running` forever: the dashboard showed a permanently RUNNING row whose Stop was a no-op (nothing was left to consume `control.jsonl`), and it only cleared on a daemon restart. The run now records its owning pid and host in `run.json`, and `readLiveMeta` flips a `running` run to `stopped` (and archives it) on read when that owning process is gone on this host, so the dashboard clears the stuck row on the next poll. Runs whose meta predates this field are left to the existing boot-time reconcile.
