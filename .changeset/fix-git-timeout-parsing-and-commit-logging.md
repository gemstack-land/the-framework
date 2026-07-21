---
'@gemstack/framework': patch
---

`gitTimeoutMs()` no longer mistakes the value of a global git option for the subcommand, and a
conversation commit that keeps failing now says why.

`gitTimeoutMs()` picked the subcommand by dropping every word that starts with `-`, which drops
the flags but keeps the values of the global options that take one. `git -C /repo push` therefore
read as the subcommand `/repo`, and the push silently got the 30s local-mutation budget instead of
its intended 120s network budget. The same held for `-c key=val`, `--git-dir`, `--work-tree`,
`--namespace` and `--exec-path`. The leading global options are now skipped properly, value and
all, so the real subcommand is what picks the budget. No call site in the package passes `-C`
today, so no timeout that was already correct changes; this closes the trap before a future call
site falls into it. `gitTimeoutMs()`'s signature is unchanged.

The conversation committer logged only its successes. `commitConversations()` returns a reason
when it declines or fails, and the poller dropped it, so a project whose commit failed every tick
re-queued itself forever while printing nothing at all. The reason is now logged, but on change
only: the first failure prints one line, and repeats of the same reason stay quiet until the
reason changes or the commit lands, so a stuck project cannot flood the daemon log one line per
poll window. The ordinary "no conversation changes" outcome is never reported as a failure.
