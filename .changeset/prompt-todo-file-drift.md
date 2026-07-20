---
'@gemstack/framework': patch
---

Point the prompting at `TODO_AGENTS.md`, the queue file the code actually promotes (#885)

Both `${{ }}` blocks of the system prompt declared `TODO_FILE` as `TODO_<SESSION_NAME>.agent.md`,
while the code had already moved to the flat `TODO_AGENTS.md`: that name is `FLAT_TODO_FILE`, the
session-scoped one is `LEGACY_TODO_FILE`, and `promoteQueue` carries only the flat file off a run's
branch.

So an agent following the prompt wrote its backlog to a legacy name that nothing promotes, and an
unattended run's queue never reached the checkout. The reader tolerates both names, which is why
this stayed invisible.

The two assertions that pinned the old name now derive it from `FLAT_TODO_FILE` instead of
hardcoding a literal, so the prompt cannot silently desync from the code again.
