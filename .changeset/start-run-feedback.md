---
"@gemstack/framework": minor
---

Give the dashboard clear feedback when a run is started. A run is spawned detached, so there was a gap between clicking Start and the first event (and a failed launch produced nothing, so the page looked frozen). Now clicking Start shows an immediate "Starting your run..." banner; if no output arrives within ~8s it warns that the run may have failed to start; a run-launch/exit failure surfaces as an error banner; and a rejected Start (a run is already active) shows a clear "busy" banner instead of a tiny note.
