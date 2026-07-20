---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Tell the human when a finished run left work nobody pushed (#860)

An unattended run writes real code, commits it to its own branch, and then nothing surfaces it. The
"needs you" queue knew about exactly two things: a pull request that is *already on GitHub*, and a
run parked on a choice gate. A run that finished with committed work and no PR was neither, so the
notification only fired after a human had already clicked "Open PR" — which they would only do if
they already knew the work was there. The overview drops the run too, since it lists only what is
still running, and the push/open-PR panel is behind clicking into that specific archived run.

The queue now has a third kind: a finished run whose branch still holds commits that were never
pushed and never merged. It rides the existing watcher, so it reaches the browser notification and
the Discord message like any other item.

Surfacing only. Pushing publishes the agent's work under the user's name to a shared remote, and
that stays a deliberate click rather than something a run ending does on its own — this only says
there is a decision waiting.

Only the most recent finished runs per project are inspected, since each costs several git reads on
a poll and work that has sat unpushed for dozens of runs is not news. The per-branch `gh` PR lookup
is skipped for this: an open PR means the branch was pushed, which already excludes it.

This became reachable when unattended runs started shipping diffs, and the Discord chatbot (#680)
widened it further — a run started from chat is unattended too.
