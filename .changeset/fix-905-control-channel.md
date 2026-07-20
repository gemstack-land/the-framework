---
'@gemstack/framework': patch
---

Fix Stop doing nothing, and headless runs never exiting (#905)

A run decided whether it could be steered by asking whether *a daemon was alive on this machine*.
That is not a fact about the run, and it was wrong in both directions.

The daemon spawns every run with `--no-dashboard`, so that check was the only thing wiring their
control channel. When the daemon's state file went missing while the daemon was still running (it
deletes itself on a stale pid and is never rewritten, #922), spawned runs stopped watching the
control channel: every Stop press was written to disk and read by nobody, with no error shown.

The same check ran the other way too. A run typed into a terminal with `--no-dashboard` picked up a
control channel just because a daemon existed somewhere, which handed it the live-chat queue, and
it waited forever for a message that terminal could never send.

Those are now two separate questions. A run is steerable when it has its own dashboard, when a
daemon is live (unchanged, so a daemon still steers runs it did not start), or when whoever spawned
it gave it a run id, which is what the daemon does and what holds when the state file does not. A
run stays open for chat only when someone is actually waiting in it: its own dashboard, or the
daemon started it. Stop and choice picks keep working either way.
