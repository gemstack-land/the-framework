---
'@gemstack/ai-sdk': minor
---

fix(ai-sdk): a resumed conversation id is now checked against the user the run is scoped to

`preparePersistence` loaded a conversation by id without ever reading `spec.user`, so `agent.forUser('alice').continue(bobsConversationId)` read Bob's whole thread into Alice's run and appended Alice's turn back into it. The same reached through `prompt(input, { conversation: { user: 'alice', id: bobsConvId } })` and through the streaming variant. Conversation ids are ordinary identifiers here, not secrets, and a resume endpoint takes one straight off a request.

The owner was already recorded at create time and simply never consulted. It is now read back before the load, and a mismatch throws the new `ConversationOwnershipError` (exported, so a server can answer 403 rather than 500). The error names the conversation and the user the run was scoped to, never the real owner.

`ConversationStore.load()` is unchanged. Ownership is read from `ConversationStoreListEntry.userId`, a new optional field mirroring `ConversationStoreMeta.userId` the way `agent` already does, and `MemoryConversationStore` reports it.

Two deliberately permissive cases:

- A thread whose stored meta carries no `userId`, and any store that does not report `userId` in its listings, stays resumable by whoever holds the id. Existing stored conversations do not become unreadable.
- A bare `continue(id)` with no user is not a special error; it carries an empty user and fails the same owner check, so it still resumes unowned threads and is refused for owned ones.

That second point changes a documented flow: `myAgent.forUser('u').prompt(...)` followed by `myAgent.continue(id).prompt(...)` now throws. Chain `forUser('u').continue(id)` instead. The docs shipped with the package have been corrected.
