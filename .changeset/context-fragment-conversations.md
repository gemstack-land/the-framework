---
'@gemstack/framework': minor
---

feat(framework): context fragment lists the recorded conversations (#683)

Adds `.the-framework/conversations/**.md` to `CONTEXT_DOCS`, so a run is told to read the human conversations (Discord/chat turns) that earlier runs committed there. A read-only pointer, like `tickets/` and `TODO_AGENTS.md`, so it stays out of the merge-update set. The path is pinned by a test to the canonical `THE_FRAMEWORK_DIR`/`CONVERSATIONS_DIR` constants so it cannot drift from where runs actually commit.
