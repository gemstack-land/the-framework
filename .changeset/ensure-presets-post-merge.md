---
"@gemstack/framework": patch
---

`runPostMerge` now materializes the quality presets before queueing, so the post-merge TODO entries' `filePath` values always resolve (#598). Previously the presets were written only on install and are gitignored, so a repo activated before that feature shipped, or a fresh clone, had no preset files and the queued entry pointed at a path that did not exist. Best-effort: a materialize failure is reported, never fatal.
