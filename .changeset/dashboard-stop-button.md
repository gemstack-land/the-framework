---
'@gemstack/framework': minor
---

Stop a run from the dashboard

The dashboard now has a **Stop** button that interrupts the running build from the browser, instead of only from the terminal. It POSTs to a new `/stop` route that aborts the run's `AbortSignal`, which `runFramework` checks between phases and the driver honours mid-turn (it kills the current agent turn). The run ends cleanly as *stopped* (not *failed*): the CLI prints `■ Stopped` and exits 0, the dashboard shows a stopped status, and the persisted run records `status: "stopped"` so `--resume` shows it that way.

`startDashboard` gains an `onStop` option (wire it to `controller.abort()`); the page hides the button when no stop handler is wired (e.g. a read-only `--resume` view). The `end` event gained an optional `stopped` flag.

Part of #110 (first interactive slice of #165's web client). Closes #218.
