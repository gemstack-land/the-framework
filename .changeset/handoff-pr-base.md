---
"@gemstack/the-framework": patch
---

Fix two faults in opening a session's pull request, both found by driving the handoff against a real GitHub remote rather than a stubbed one.

**The PR base was a tracking ref, so opening a PR failed outright.** `RunHandoff.base` holds what `detectBase` reads out of `refs/remotes/origin/HEAD`, which is `origin/main`. That is correct for the two things the field is otherwise used for, since the commit range and the merged check are both asking git about a remote-tracking ref. It is not a thing you can open a PR against: `gh pr create --base origin/main` is rejected with `Base ref must be a branch`. The name is now converted at the `gh` boundary, leaving the field as the git ref it is. This affected the manual **Open PR** button too, on any repo whose default branch is discovered through `origin/HEAD`.

**The "this branch already has a PR" guard could be defeated by a cold cache.** The check read through the dashboard's cached PR lookup, which answers `prPending` rather than yes-or-no while it refreshes. "Not known yet" therefore read as "no PR", and a second handoff for the same branch went ahead and tried to open another one; only `gh` refusing the duplicate stopped it. The handoff now takes the uncached lookup and waits for a real answer. It runs once, at the end of a session, so it can afford to.
