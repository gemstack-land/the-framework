---
'@gemstack/framework': patch
---

The Browser pane recovers from a failed stream instead of latching "not reachable" (#946)

One img error (e.g. opening the tab before the run's stream endpoint was up) permanently swapped
in the failure message until a remount. The failure is now keyed to the exact stream it happened
on, so switching runs starts clean, and a Retry button re-requests the stream. The fix lives in
the dashboard client, which ships bundled inside this package.
