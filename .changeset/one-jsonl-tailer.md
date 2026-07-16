---
"@gemstack/framework": patch
---

Fix the dashboard's event tail dropping a same-length rewrite. There were two JSONL tailers: `JsonlTailer` detects an in-place truncate both by the file shrinking and by it being rewritten to the same length (mtime advanced), while `tailEvents`, which is what the dashboard Channel runs, only checked for a shrink and never read mtime. A fresh run that rewrote `events.jsonl` to the same byte length was invisible to the dashboard. The two tailers, and the two hand-rolled `fs.watch`-plus-poll drivers behind them, are now one `JsonlTailer` + one `followFile`, so the run's control tail and the dashboard's event tail share the tested behavior instead of drifting. `tailEvents` had no test of its own; it has three now.
