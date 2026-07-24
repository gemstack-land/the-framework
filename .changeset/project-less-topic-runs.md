---
"@gemstack/the-framework": minor
---

Start a run with no project, in a neutral scratch directory.

A "topic" run starts project-less: it spawns in a neutral scratch dir under the config home with no repo or worktree, so the agent has no code to touch. This is the "ask a question, plan, or draft a ticket without a repo" path. It still produces the normal run lifecycle (events.jsonl, run.json, settle) inside the scratch dir.

A new `sendStartTopic` RPC starts one beside the project-scoped `sendStart`, keeping the home-default behavior untouched. The scratch dir is retained on failure or stop and removed on a clean finish, mirroring the worktree retention rule. The UI for it is tracked separately.
