---
'@gemstack/framework': minor
---

Conversations are committed to the Git repo (#908)

A project's chat was the one part of a run that git never kept. `LOGS.md` records that a session
happened, and #898 made it the complete, joinable list of them, but what was actually said lived
only in `.the-framework/`, which is transient by design (#313) — so a clone carried the index and
none of the content.

The chat now lands in `.the-framework/conversations/<runId>.md`, keyed by the same run id the
project log records, so the committed session list and the committed chat join. One file per
conversation and append-only, because run worktrees are live concurrently and each commits its own
pending work on teardown; a single shared file would conflict every time two runs chatted at once.

Only the human turns and the agent's replies are stored — not the verbose transcript, which stays
with the model provider (#857).

Message bodies stay multi-line and readable in a diff rather than being collapsed to one line the
way a `LOGS.md` field is, so only a line's leading `#` or `\` is escaped. That is enough to keep a
reply from forging a message, which is the same thing #897 fixed for the project log.

The seeded `.the-framework/.gitignore` is an allow-list written once and only when absent, so every
repo activated before this would have silently ignored its own conversations. It is upgraded in
place on first write as well as seeded correctly on a fresh install.
