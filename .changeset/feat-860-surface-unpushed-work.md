---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Tell the user when a finished run left work nobody pushed (#860)

An unattended run writes code, commits it to its own branch, and stops. Nothing says so.

The "needs you" queue only knew two things: a pull request already on GitHub, and a run parked on a
choice gate. A finished run with committed work and no PR was neither, so nothing fired until
someone had already opened the PR by hand. The overview lists only running runs, and the push
button sits inside that one archived run.

The queue now has a third kind: a finished run whose branch holds commits that were never pushed
and never merged. It rides the existing watcher, so it reaches browser notifications and Discord
like any other item.

It only tells you. Pushing publishes the agent's work under your name, so that stays your click.

Only the most recent finished runs per project are checked, since each one costs a few git reads on
every poll.
