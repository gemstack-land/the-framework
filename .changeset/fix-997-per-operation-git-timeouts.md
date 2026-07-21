---
'@gemstack/framework': minor
---

Git operations get a timeout budget chosen by subcommand, and a timeout is now distinguishable
from a command git rejected.

One flat 10s budget covered every git invocation in the package, the repo's ~20 call sites, which
meant the two slowest ran under what is really a read's budget. `git worktree add` writes a whole
checkout and `git push` uploads a packfile; on a large repo both routinely pass 10s, at which
point `execFile` SIGTERMs them. A killed `worktree add` drops a run into the user's main checkout
instead of its own worktree, and a killed `push` may have half-landed on the remote.

`nodeGitRunner()` now picks the budget from the args: 10s for reads (`status`, `rev-parse`,
`ls-files`, `log`, `diff`, `show`, `remote`, `rev-list`, `symbolic-ref`, `branch --list`,
`worktree list`), 30s for local mutations (`add`, `commit`, `init`, `checkout`,
`worktree remove`, `worktree prune`), and 120s for the network and for a full checkout (`push`,
`fetch`, `pull`, `clone`, `worktree add`). Reads deliberately keep the old budget: widening
everything to cover a slow op would let a hung read hold the daemon six times longer. This
mirrors the read/write split `gh` already had.

A CLI killed for outrunning its budget now rejects with a `CliTimeoutError` reading
`git push --set-upstream origin <branch> timed out after 120000ms`, rather than the bare
`Command failed: git push ...` that a SIGTERM with empty stderr used to produce. `isCliTimeout()`
tells the two apart programmatically.

`nodeGitRunner()`'s signature is unchanged; the budget is derived from the args, so every existing
call site gets the right one with no change. New exports: `gitTimeoutMs`, `GIT_READ_TIMEOUT_MS`,
`GIT_WRITE_TIMEOUT_MS`, `GIT_SLOW_TIMEOUT_MS`, `CliTimeoutError`, `isCliTimeout` and the
`CliTimeout` type. `CliRunnerOptions.timeoutMs` accepts a function of the args as well as a number.
