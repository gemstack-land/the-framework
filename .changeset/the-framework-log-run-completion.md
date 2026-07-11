---
'@gemstack/framework': minor
---

Record every finished run in the project log `.the-framework/LOGS.md` (#379). When a run ends, the CLI appends an entry with the intent/prompt title, the kind (build or prompt), the final status (done/stopped/failed), and the Claude Code session id and link. Best-effort, so a log write can never break a run. This is what makes the project DB (#378) fill itself; the run-history sidebar in #314 reads from it.
