---
'@gemstack/framework': minor
---

feat(framework): persistent background dashboard daemon (#302)

Bare `framework` now ensures a long-lived dashboard process for the workspace and prints its URL plus the convenience commands; `framework stop` shuts it down. The dashboard is a projection of `.framework/events.jsonl`: the detached daemon tails the log and pushes each new event to connected browsers, so it outlives any single run. The tailer also detects an in-place truncation when a fresh run rewrites the log to the same byte length (size unchanged but mtime advanced), and the daemon spawn refuses to re-exec a test entry so a `node --test` run can never fork-bomb itself.
