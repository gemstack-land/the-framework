---
'@gemstack/framework': patch
---

Stop a daemon boot from marking live runs as finished. The boot reconcile flipped every run meta still at `running` to `stopped`, on the assumption that a fresh daemon drives no in-flight run. That holds only while exactly one daemon ever boots, so a second one marked genuinely live runs as finished, giving them a no-op Stop in the dashboard. A meta whose recorded pid is alive on this host is now left alone; one that is provably gone, on another host, or from before the pid was recorded is reconciled as before.
