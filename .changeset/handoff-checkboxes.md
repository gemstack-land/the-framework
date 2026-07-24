---
"@gemstack/the-framework": minor
---

The end-of-session handoff happens by itself: Push branch and Open PR are now checkboxes, ticked by default.

They used to be two buttons on a finished session, and the code was explicit that they should stay clicks, on the grounds that publishing the agent's work under your name is your call. In practice that meant a click per session for the thing you almost always want, and when nobody clicked, the work stayed on a local branch nobody was told about.

The call is still yours, it is just made once instead of every time. The two controls are now **pre-commitments** in the session action bar: whatever is still ticked when the session settles happens on its own. Leave them alone and it is zero-config. Untick either one while the session runs to opt out, and the old button comes back, so the deliberate path is never lost. A failure falls back to the button too, with git's or `gh`'s own reason beside it.

The pair is not independent, because `gh` will not open a PR for a branch the remote has never seen: ticking **Open PR** arms the push, and unticking **Push branch** unticks the PR.

The PR is opened as a **draft**, so firing on every session does not put a review request in anyone's inbox. That needed one change elsewhere: the interventions queue skipped every draft, on the grounds that a draft is not asking for review. For a PR the framework opened for itself that reasoning inverts, since then nothing would tell you the work exists at all. The queue now lists a draft on a `the-framework/*` branch and still skips drafts opened by hand.

New per-project preferences `autoPushBranch` and `autoOpenPr` set where the boxes start; both default on. The CLI has `--no-auto-push-branch` and `--no-auto-open-pr`, which travel as explicit `--no-*` flags for the same reason the repo-config toggles do: these default on, so silence would re-arm them.

The handoff runs after the on-before-mergeable quality pass, so anything that pass committed is included, and it commits the session's own pending work first, which teardown would otherwise only do after the run process had exited. It declines rather than acting on a stopped run, a branch that is gone, a session that committed nothing, a repo with no remote, and a branch that already has a PR.
