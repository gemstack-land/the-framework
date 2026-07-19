---
'@gemstack/framework-dashboard': minor
'@gemstack/framework': minor
---

Show the session's file changes in the run output (#817). A Changes section above the event log lists every file the session touched with its line counts, each row expanding to the diff. Adds `onRunChanges`, one `git status` plus one `git diff --numstat` per poll rather than a diff per file. Derived from the worktree rather than the agent's tool calls, which carry a tool's name and not its arguments (#165), so it works for every agent and reports the outcome rather than the intent.
