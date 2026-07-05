---
'@gemstack/framework': minor
---

Repo files as persistent AI memory (#260).

The agent now reads the project's special files (CODE-OVERVIEW.md,
KNOWLEDGE-BASE.md, BRAINSTORMING.md, DECISIONS.md) at the start of a run and is
told to keep the ones it owns current, so a project's memory lives in the repo as
plain markdown and the next run picks up where the last left off. `DECISIONS.md`
stays framework-owned (we write it from the decisions ledger), so the agent reads
it but does not edit it. New: `loadRepoMemory(cwd)`, `memoryFraming`,
`MEMORY_FILES`, and a `memory` option on `runFramework`; the CLI reads the files
from the workspace and frames them alongside personas and skills.
