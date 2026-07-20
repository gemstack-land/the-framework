---
'@gemstack/framework': minor
---

The launcher shows what a session will actually run with (#842)

`the-framework.yml` was read exactly once, inside the freshly spawned CLI child. The daemon never
read it and the dashboard never saw it, so the gear could only ever show your own preferences
while the repo's committed options quietly took effect later.

The project payload now carries the repo file, read fresh on each request. The dashboard resolves
the same layers the CLI does, nearest first: your project options, the repo's `the-framework.yml`,
then your global preferences. The launcher lists what is in play inline, without opening the gear,
and marks the values that come from the repo rather than from you.

Because the launcher now resolves the repo file itself, a start sends the four toggles it owns
(autopilot, technical, vanilla, transparent) explicitly, including `false`, which the CLI takes as
the nearest layer. Turning one off in the gear no longer gets undone by the repo file. Runs the
daemon starts on its own resolve through the same layers.
