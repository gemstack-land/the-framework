---
'@gemstack/framework': minor
---

Restore the dashboard actions on the new dashboard (#433): the Start form now carries the Global options (autopilot, technical, vanilla, eco) and the run presets (Research, Readability, Maintainability), the interactive choice gate auto-accepts the recommended pick on an autopilot countdown, a Deploy card shows the chosen render + target, and projects can be added from the Projects sidebar over a new `sendAddProject` telefunction. Adds a browser-safe `deployPlan` projection and the preset builders to `@gemstack/framework/client`.
