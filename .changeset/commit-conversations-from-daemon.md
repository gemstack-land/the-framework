---
'@gemstack/framework': minor
---

The daemon now commits the conversations it records on a project's main checkout, so a chat reaches the Git repo without waiting for someone to commit it by hand. A run's own worktree already swept its transcript on teardown; a conversation held in the checkout itself had nothing doing the same, and sat as an uncommitted change indefinitely. The commit is scoped to `.the-framework/conversations` and never stages anything else, so work in progress elsewhere in the checkout, staged or not, is left exactly as it was. It is debounced on an idle window rather than committed per turn, batching a burst of chat into one commit, with a cap so a conversation that never falls idle still lands. A repo that is mid-rebase, mid-merge or holding its index lock is skipped and retried later rather than committed into, and the daemon flushes anything still pending as it shuts down.
