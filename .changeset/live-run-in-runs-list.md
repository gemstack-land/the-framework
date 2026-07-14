---
"@gemstack/framework": minor
---

Dashboard: show the live run in the Runs rail with a RUNNING status. The in-progress run now appears as the top row of the list (pulsing dot, RUNNING badge, and the prompt), matching the history rows, instead of being hidden behind the abstract "Live" button; clicking it follows the live stream as before. `onRuns` prepends the live run (from `run.json`) when one is running, and the Start form seeds an optimistic row so the run shows the instant you click Start, before the spawned process writes its `run.json`.
