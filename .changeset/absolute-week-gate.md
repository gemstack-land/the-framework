---
'@gemstack/framework': patch
---

Auto PM no longer spends the last of the quota after a daemon restart (#848)

The consumption meter measures how much usage has gone up since it started watching,
so a restarted daemon had nothing to compare its first reading against and reported
zero consumed no matter what the account had actually spent. Auto PM read that as a
full budget.

It now also checks the account's own weekly figure, which is absolute and survives a
restart, and refuses when that cannot be read.
