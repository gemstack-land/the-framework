---
'@gemstack/the-framework': patch
---

Auto-merge now requires the agent's word (#1363, rule settled on #1390). An armed merge only runs when the agent declared the session done via `setReadyForMerge()` — previously the merge fired on config alone, landing work on main that the agent never said was finished. Second check, a temporary safety belt: the session's own `TODO_<SESSION_NAME>.agent.md` must have no open entries. The global `TODO_AGENTS.md` queue never withholds a merge — it is decoupled from sessions. A withheld merge is not a skipped handoff: the branch is still pushed and the PR still opens, as a draft, and the handoff event says why the merge did not run. The system prompt's closing instruction is now a required terminal action rather than a suggestion, so agents reliably signal when their work is done.
