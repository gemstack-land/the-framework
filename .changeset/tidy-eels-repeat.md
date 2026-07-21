---
'@gemstack/framework': minor
---

Dashboard: the session's branch row fills in about three times faster. It was waiting on a `gh pr view` (≈574ms, against ~10ms for every git read beside it) that ran twice per session, on every navigation and every poll. That lookup is now read through a single-flight, stale-while-revalidate cache, and it no longer blocks the branch, dirty flag, size, commits or files — they render at git speed while the PR arrives behind them. Opening a PR invalidates the cached answer, and a lookup still in flight is reported as pending rather than as "no PR", so the Open PR button holds off instead of offering to open a second one.
