---
"@gemstack/framework": patch
---

Give the room to a big view (#862). The right rail is where the agent's pushed views, its browser and its choice gates are read, and it was a fixed narrow column whatever it held. It now widens for those three, and the sessions rail shrinks to a strip of status dots for as long as they are shown. Hovering the strip, or tabbing into it, brings the sessions back over the main pane rather than pushing it aside, so nothing you are reading moves. A list-shaped tab (files, docs, log) returns both rails to their usual widths.
