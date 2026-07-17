---
"@gemstack/framework": patch
---

Consolidate the dashboard header's three notification icons (browser bell, Discord, activity pulse) into one labeled "Notifications" bell that opens a popover (#676). The popover groups the toggles the way the model actually works: a "Deliver to" section (Browser, Discord) for where notifications go, and a "Notify me about" section where "Needs you" is shown as always-on and "New activity" is an opt-in toggle. The bell shows an active state and dot when a delivery method is on. Purely the header control; the underlying preferences and notification hooks are unchanged.
