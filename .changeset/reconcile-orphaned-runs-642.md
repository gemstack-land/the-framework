---
'@gemstack/framework': patch
---

Reconcile orphaned runs on daemon start. A run a dead process left marked `running` (a crash, kill, or daemon restart) no longer shows as active forever with a no-op Stop: a freshly started daemon drives no in-flight run, so at boot any such run across registered projects is flipped to `stopped` (the live one archived first, keeping its history).
