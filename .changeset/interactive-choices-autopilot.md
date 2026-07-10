---
'@gemstack/framework': minor
---

feat(framework): interactive plan-approval choice + autopilot in the dashboard (#304)

The run now pauses at a plan-approval gate right after the architect decides the stack (the AWAIT point of the plan-then-AWAIT flow): the dashboard shows a "Your call" panel with "Proceed" plus each architect alternative as "Use X instead". Accept with the button or Ctrl+Enter, or leave the `[x] autopilot` countdown auto-accept the recommended plan after 10s (moving the mouse cancels it). Picking an alternative re-architects the run around it. New `requestChoice` option on `runFramework`, `choice` / `choice-resolved` events, and a `POST /choice` dashboard route; a headless run with no handler auto-accepts the recommended plan, so nothing else changes. Closes #304.
