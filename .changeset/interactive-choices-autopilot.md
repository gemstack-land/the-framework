---
'@gemstack/framework': minor
---

feat(framework): interactive choice gate + autopilot in the dashboard (#304)

A run can now pause on a choice and wait for you: the dashboard shows a "Your call" panel with the options. Accept with the button or Ctrl+Enter, or leave the `[x] autopilot` countdown auto-accept the recommended option after 10s (moving the mouse cancels it). New `requestChoice` option on `runFramework`, `choice` / `choice-resolved` events, and a `POST /choice` dashboard route; a headless run with no handler auto-accepts the recommended option, so nothing else changes. Closes #304.
